// LifeOS — global app context: auth session, theme, navigation, toasts
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getClient, loadSupabaseConfig, hasSupabase } from '../lib/supabase';
import { getSession, onAuthChange, signOut as authSignOut } from '../lib/auth';
import { initStore, resetStore, setToastFn, flush, pull, getOutboxCount, getOnline, subscribeDb, currentUserId, getDbVersion } from '../lib/db';
import { isGuest, startGuest, exitGuest, guestId, snapshotGuest, clearGuestBackup } from '../lib/guest';
import { dbState } from '../lib/db';
import { startReminderScheduler } from '../lib/notifications';
import { KageAmbient } from '../site/KageAmbient';

export type Page =
  | 'home' | 'today' | 'tasks' | 'calendar' | 'weekly' | 'projects' | 'goals'
  | 'library' | 'stats' | 'focus' | 'search' | 'settings' | 'reminders'
  | 'productivity' | 'review'
  // legacy keys kept so old deep links / bookmarks don't break
  | 'notes' | 'ideas' | 'remember';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast { id: number; msg: string; kind: ToastKind; }

export type PremiumTheme = 'kage' | 'noir';

export function applyPremiumTheme(root: HTMLElement, t: PremiumTheme | null): void {
  // 'theme-zen', 'theme-focus', 'theme-nordic' and 'theme-editorial' are
  // retired — classes are still scrubbed so upgrading users shed stale ones.
  for (const c of ['theme-kage', 'theme-zen', 'theme-focus', 'theme-nordic', 'theme-noir', 'theme-editorial']) root.classList.remove(c);
  if (t) root.classList.add(`theme-${t}`);
}

interface AppContextShape {
  session: Session | null;
  authLoading: boolean;
  configured: boolean;
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  premiumTheme: PremiumTheme | null;
  setPremiumTheme: (t: PremiumTheme | null) => void;
  page: Page;
  navigate: (p: Page, params?: Record<string, string>) => void;
  pageParams: Record<string, string>;
  toast: (msg: string, kind?: ToastKind) => void;
  signOut: () => Promise<void>;
  continueAsGuest: () => void;
  migrateGuestIntoAccount: (preSnap?: Record<string, any[]>) => Promise<{ ok: boolean; message: string }>;
  syncNow: () => Promise<void>;
  online: boolean;
  pendingOps: number;
  version: number;
}

const AppContext = createContext<AppContextShape | null>(null);
export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
};

let toastId = 1;

export function isDemoMode(): boolean {
  return typeof window !== 'undefined' && window.location.hash === '#demo';
}

/** Guest mode flag exposed through context (stable across renders). */
let guestActive = false;
export function isGuestMode(): boolean { return guestActive; }

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean>(() => hasSupabase() || isDemoMode() || isGuest());
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(
    () => (localStorage.getItem('lifeos.theme') as any) ?? 'dark'
  );
  const [premiumTheme, setPremiumThemeState] = useState<PremiumTheme | null>(
    () => (localStorage.getItem('lifeos.premiumTheme') as PremiumTheme) ?? 'kage'
  );
  const [page, setPage] = useState<Page>(() => {
    // Restore the page across pull-to-refresh reloads (app shell reloads
    // the whole SPA); falls back to Home on a fresh session.
    try { return (sessionStorage.getItem('lifeos.page') as Page) ?? 'home'; } catch { return 'home'; }
  });
  const [pageParams, setPageParams] = useState<Record<string, string>>(() => {
    try { return JSON.parse(sessionStorage.getItem('lifeos.pageParams') ?? '{}'); } catch { return {}; }
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(getOnline());
  const [pendingOps, setPendingOps] = useState(0);
  const [version, setVersion] = useState(0);

  const toast = useCallback((msg: string, kind: ToastKind = 'info') => {
    const id = toastId++;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  useEffect(() => { setToastFn(toast); }, [toast]);

  useEffect(() => {
    let cancelled = false;
    // Demo mode: skip Supabase entirely, run fully local
    if (isDemoMode()) {
      guestActive = false;
      setAuthLoading(true);
      initStore('demo-user')
        .then(() => {
          if (!cancelled) { setSession({ user: { id: 'demo-user', email: 'demo@lifeos.local' } } as any); setAuthLoading(false); }
        })
        .catch(() => { if (!cancelled) setAuthLoading(false); });
      return () => { cancelled = true; };
    }
    // Guest mode: local-only session, no server contact at all.
    if (isGuest()) {
      guestActive = true;
      setAuthLoading(true);
      const gid = startGuest().id;
      initStore(gid)
        .then(() => {
          if (!cancelled) {
            setSession({ user: { id: gid, email: null } } as any);
            setAuthLoading(false);
          }
        })
        .catch(() => { if (!cancelled) setAuthLoading(false); });
      return () => { cancelled = true; };
    }
    let unsub: (() => void) | null = null;
    (async () => {
      const sb = getClient();
      if (!sb) { setAuthLoading(false); return; }
      const s = await getSession();
      if (cancelled) return;
      setSession(s);
      setAuthLoading(false);
      const un = onAuthChange((sess) => setSession(sess));
      unsub = () => un();
    })();
    return () => { cancelled = true; unsub?.(); };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
      applyPremiumTheme(root, premiumTheme);
      // The Kage ambient layer (cursor spotlight + embers + moon glow) rides
      // along with the Kage theme. Other themes stay clean.
      if (premiumTheme === 'kage') root.setAttribute('data-kage-ambient', '');
      else root.removeAttribute('data-kage-ambient');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, premiumTheme]);

  // Kage ambient canvas (app side). Mounted once; it self-disables under
  // prefers-reduced-motion and pauses when the tab is hidden.
  const [kageAmbient, setKageAmbient] = useState(premiumTheme === 'kage');
  useEffect(() => { setKageAmbient(premiumTheme === 'kage'); }, [premiumTheme]);

  // Initialize store when a session appears
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        await initStore(session.user.id);
      } catch (e) {
        console.error('initStore failed', e);
        toast('Could not load local data. Trying a fresh sync…', 'error');
        await pull();
      }
      if (!cancelled) startReminderScheduler();
      // Hand upcoming alarms to the native layer (Android shell / Electron)
      // so alarms ring even when the app is closed. No-op in browsers.
      import('../lib/nativeAlarms').then((m) => m.startNativeAlarmSync());
      // Tell the Android shell when the page is scrolled to the top
      // (pull-to-refresh gating). No-op elsewhere.
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  useEffect(() => { void pull(); }, []);

  useEffect(() => {
    const t = subscribeDb(() => {
      setVersion(getDbVersion());
      setOnline(getOnline());
      setPendingOps(getOutboxCount());
    });
    return t;
  }, []);

  const navigate = useCallback((p: Page, params?: Record<string, string>) => {
    // 'weekly' merged into Productivity's Plan view (keep old links working)
    if (p === 'weekly') {
      setPage('productivity'); setPageParams({ view: 'plan', ...(params ?? {}) });
      try { sessionStorage.setItem('lifeos.page', 'productivity'); sessionStorage.setItem('lifeos.pageParams', JSON.stringify({ view: 'plan', ...(params ?? {}) })); } catch { /* ignore */ }
      window.scrollTo(0, 0); return;
    }
    setPage(p);
    setPageParams(params ?? {});
    try { sessionStorage.setItem('lifeos.page', p); sessionStorage.setItem('lifeos.pageParams', JSON.stringify(params ?? {})); } catch { /* ignore */ }
    window.scrollTo(0, 0);
  }, []);

  const setTheme = useCallback((t: 'light' | 'dark' | 'system') => {
    setThemeState(t);
    try { localStorage.setItem('lifeos.theme', t); } catch { /* ignore */ }
  }, []);

  const setPremiumTheme = useCallback((t: PremiumTheme | null) => {
    setPremiumThemeState(t);
    try {
      if (t) localStorage.setItem('lifeos.premiumTheme', t);
      else localStorage.removeItem('lifeos.premiumTheme');
    } catch { /* ignore */ }
  }, []);

  const signOut = useCallback(async () => {
    // Leaving guest mode intentionally KEEPS the guest identity + local rows
    // so the user can return or migrate later — clearing happens only on
    // explicit deletion of guest data.
    const wasGuest = guestActive;
    if (wasGuest) {
      guestActive = false;
      exitGuest(); // keeps guest:<id> cache for return; never uploads anything
    }
    await authSignOut();
    // Guest rows live only in this browser — never wipe them on sign-out.
    await resetStore({ wipeCache: !wasGuest });
    setSession(null);
    setPage('home');
  }, []);

  /** Enter guest mode from the auth screen (mounts a local-only session). */
  const continueAsGuest = useCallback(() => {
    startGuest();
    guestActive = true;
    const gid = guestId();
    setAuthLoading(true);
    initStore(gid)
      .then(() => {
        setSession({ user: { id: gid, email: null } } as any);
        setAuthLoading(false);
      })
      .catch(() => setAuthLoading(false));
  }, []);

  /** Copy a guest snapshot into the just-signed-in account, then clean up.
   * The snapshot MUST be captured before sign-in (sign-in resets the store),
   * so callers pass it in — or we recover it from the IndexedDB backup that
   * snapshotGuest wrote before the auth round-trip. */
  const migrateGuestIntoAccount = useCallback(async (preSnap?: Record<string, any[]>): Promise<{ ok: boolean; message: string }> => {
    const { getGuestBackup, snapshotGuest, clearGuestBackup, collectGuestSnapshot } = await import('../lib/guest');
    const { migrateGuestData } = await import('../lib/migrateGuest');
    // Prefer the caller's pre-auth snapshot; otherwise gather from the live
    // store, the guest's IndexedDB cache, or the durable backup — in that order.
    const snap = preSnap ?? (await collectGuestSnapshot());
    // The store may not be initialized for the new account yet (the session
    // effect runs initStore after React re-renders, while we're a microtask
    // right behind signIn()). Wait briefly so inserts land under the right uid;
    // without this the migration bails with "Not signed in".
    const waitStart = Date.now();
    while (!currentUserId() && Date.now() - waitStart < 5000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!snap || !Object.values(snap).some((rows: any) => rows?.length > 0)) {
      guestActive = false;
      exitGuest();
      return { ok: true, message: 'Nothing to migrate — guest data was empty.' };
    }
    await snapshotGuest(snap); // persist backup before touching the account
    const report = await migrateGuestData(snap);
    if (!report.ok) {
      return { ok: false, message: report.error ?? 'Migration failed — your guest data is preserved on this device and will migrate next time.' };
    }
    await clearGuestBackup();
    guestActive = false;
    exitGuest();
    const total = Object.values(report.copied).reduce((a, b) => a + b, 0);
    return { ok: true, message: `Migrated ${total} item${total === 1 ? '' : 's'} to your account.` };
  }, []);

  const syncNow = useCallback(async () => {
    await flush();
    await pull();
    toast('Sync complete', 'success');
  }, [toast]);

  const value = useMemo<AppContextShape>(() => ({
    session, authLoading, configured: configured || isDemoMode(), theme, setTheme, premiumTheme, setPremiumTheme, page, navigate, pageParams,
    toast, signOut, continueAsGuest, migrateGuestIntoAccount, syncNow, online, pendingOps, version,
  }), [session, authLoading, configured, theme, setTheme, premiumTheme, setPremiumTheme, page, navigate, pageParams, toast, signOut, continueAsGuest, migrateGuestIntoAccount, syncNow, online, pendingOps, version]);

  return (
    <AppContext.Provider value={value}>
      {children}
      {kageAmbient && <KageAmbient enabled />}
      {/* toast host */}
      <div className="fixed z-[100] bottom-4 right-4 flex flex-col gap-2 max-w-[92vw]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`card px-4 py-3 text-sm shadow-lg border-l-4 animate-slide-up ${
              t.kind === 'error' ? 'border-l-rose-500 bg-rose-50 dark:bg-rose-950/40' :
              t.kind === 'success' ? 'border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/40' :
              'border-l-indigo-500 bg-white dark:bg-slate-900'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

