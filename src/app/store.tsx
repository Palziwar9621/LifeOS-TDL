// LifeOS — global app context: auth session, theme, navigation, toasts
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getClient, loadSupabaseConfig, hasSupabase } from '../lib/supabase';
import { getSession, onAuthChange, signOut as authSignOut } from '../lib/auth';
import { initStore, resetStore, setToastFn, flush, pull, getOutboxCount, getOnline, subscribeDb, currentUserId, getDbVersion } from '../lib/db';
import { startReminderScheduler } from '../lib/notifications';

export type Page =
  | 'home' | 'today' | 'tasks' | 'calendar' | 'weekly' | 'projects' | 'goals'
  | 'library' | 'stats' | 'focus' | 'search' | 'settings' | 'reminders'
  | 'productivity' | 'review'
  // legacy keys kept so old deep links / bookmarks don't break
  | 'notes' | 'ideas' | 'remember';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast { id: number; msg: string; kind: ToastKind; }

interface AppContextShape {
  session: Session | null;
  authLoading: boolean;
  configured: boolean;
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  page: Page;
  navigate: (p: Page, params?: Record<string, string>) => void;
  pageParams: Record<string, string>;
  toast: (msg: string, kind?: ToastKind) => void;
  signOut: () => Promise<void>;
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean>(() => hasSupabase() || isDemoMode());
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(
    () => (localStorage.getItem('lifeos.theme') as any) ?? 'system'
  );
  const [page, setPage] = useState<Page>('home');
  const [pageParams, setPageParams] = useState<Record<string, string>>({});
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
      setAuthLoading(true);
      initStore('demo-user')
        .then(() => {
          if (!cancelled) { setSession({ user: { id: 'demo-user', email: 'demo@lifeos.local' } } as any); setAuthLoading(false); }
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
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

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
      if (!cancelled) {
        // Adopt alarms turned off natively (Android notification action)
        // BEFORE the scheduler's first check — otherwise a stopped alarm
        // rings again the moment the app opens.
        import('../lib/nativeAlarms').then((m) => {
          m.adoptNativeDismissals();
          startReminderScheduler();
          m.startNativeAlarmSync();
        });
      }
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
    if (p === 'weekly') { setPage('productivity'); setPageParams({ view: 'plan', ...(params ?? {}) }); window.scrollTo(0, 0); return; }
    setPage(p);
    setPageParams(params ?? {});
    window.scrollTo(0, 0);
  }, []);

  const setTheme = useCallback((t: 'light' | 'dark' | 'system') => {
    setThemeState(t);
    try { localStorage.setItem('lifeos.theme', t); } catch { /* ignore */ }
  }, []);

  const signOut = useCallback(async () => {
    await authSignOut();
    await resetStore();
    setSession(null);
    setPage('home');
  }, []);

  const syncNow = useCallback(async () => {
    await flush();
    await pull();
    toast('Sync complete', 'success');
  }, [toast]);

  const value = useMemo<AppContextShape>(() => ({
    session, authLoading, configured: configured || isDemoMode(), theme, setTheme, page, navigate, pageParams,
    toast, signOut, syncNow, online, pendingOps, version,
  }), [session, authLoading, configured, theme, setTheme, page, navigate, pageParams, toast, signOut, syncNow, online, pendingOps, version]);

  return (
    <AppContext.Provider value={value}>
      {children}
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

