// LifeOS — responsive app shell
import React, { useEffect, useState } from 'react';
import { useApp } from './store';
import { isDemoMode } from './store';
import type { Page } from './store';
import { Icon, Logo, Avatar, useConfirm } from '../ui/components';
import { getProfile, getOutboxCount, subscribeDb } from '../lib/db';
import { QuickAddModal } from './quickadd';

const NAV: { key: Page; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'today', label: 'Today', icon: 'sun' },
  { key: 'tasks', label: 'Tasks', icon: 'list' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'weekly', label: 'Weekly Plan', icon: 'calendar' },
  { key: 'productivity', label: 'Productivity', icon: 'check' },
  { key: 'projects', label: 'Projects', icon: 'folder' },
  { key: 'goals', label: 'Goals', icon: 'target' },
  { key: 'library', label: 'Library', icon: 'note' },
  { key: 'stats', label: 'Insights', icon: 'chart' },
  { key: 'focus', label: 'Focus', icon: 'focus' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { page, navigate, session, signOut, toast } = useApp();
  const [qOpen, setQOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, setPending] = useState(getOutboxCount());
  const { confirm, confirmEl } = useConfirm();

  useEffect(() => {
    return subscribeDb(() => {
      setPending(getOutboxCount());
    });
  }, []);

  useEffect(() => {
    const hotkeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        navigate('search', {});
      }
    };
    window.addEventListener('keydown', hotkeys);
    return () => window.removeEventListener('keydown', hotkeys);
  }, [navigate]);

  const profile = getProfile();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar (md+) */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-slate-900/5 dark:border-white/10 bg-white/70 dark:bg-slate-900/60 backdrop-blur px-3 py-4">
        <div className="px-2 pb-4"><Logo /></div>
        <nav className="flex-1 overflow-y-auto space-y-0.5" aria-label="Main navigation">
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`nav-item w-full text-left ${page === item.key ? 'nav-item-active' : ''}`}
              onClick={() => navigate(item.key)}
              aria-current={page === item.key ? 'page' : undefined}
            >
              <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.key === 'tasks' && pending > 0 && (
                <span className="chip chip-warn !py-0 text-[10px]">{pending}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="divider my-2" />
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar url={profile?.avatar_url} name={profile?.username ?? session?.user?.email} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{profile?.username ?? 'You'}</p>
            <p className="truncate text-xs muted">{session?.user?.email}</p>
          </div>
          <button
            className="btn-ghost btn-sm"
            aria-label="Sign out"
            onClick={() =>
              confirm('Sign out?', 'Your data stays synced to your account and this device\'s offline cache is cleared.', () => { void signOut(); }, { confirmLabel: 'Sign out', danger: false })
            }
          >
            <Icon name="logout" className="h-4 w-4" />
          </button>
        </div>
        <SyncBadge />
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="md:hidden safe-top sticky top-0 z-30 flex items-center gap-2 border-b border-slate-900/5 dark:border-white/10 bg-white/80 dark:bg-slate-950/80 backdrop-blur px-4 py-3">
          <Logo size={24} />
          <div className="flex-1" />
          <button className="btn-ghost btn-sm" aria-label="Search" onClick={() => navigate('search', {})}><Icon name="search" className="h-5 w-5" /></button>
          <button className="btn-ghost btn-sm" aria-label="Quick add" onClick={() => setQOpen(true)}><Icon name="plus" className="h-5 w-5" /></button>
        </header>

        <main className="flex-1 overflow-y-auto safe-bottom">
          {isDemoMode() && (
            <div className="bg-amber-500/15 text-amber-700 dark:text-amber-300 text-center text-xs font-semibold py-1.5 px-4">
              Demo mode — data is stored only in this browser. Add your Supabase keys for real sync.
            </div>
          )}
          <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 md:pb-10">
            {children}
          </div>
        </main>

        {/* Bottom nav (mobile) */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-900/5 dark:border-white/10 bg-white/90 dark:bg-slate-950/90 backdrop-blur safe-bottom" aria-label="Mobile navigation">
          <div className="mx-auto flex max-w-lg">
            {(['home', 'today', 'tasks', 'calendar'] as Page[]).map((k) => (
              <button
                key={k}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${
                  page === k ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'
                }`}
                onClick={() => navigate(k)}
                aria-current={page === k ? 'page' : undefined}
              >
                <Icon name={NAV.find((n) => n.key === k)?.icon ?? 'list'} className="h-5 w-5" />
                {NAV.find((n) => n.key === k)?.label}
              </button>
            ))}
            <button
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${
                moreOpen ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'
              }`}
              onClick={() => setMoreOpen(true)}
            >
              <Icon name="more" className="h-5 w-5" />
              More
            </button>
          </div>
        </nav>

        {/* More sheet (mobile) */}
        {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}
      </div>
      <QuickAddModal open={qOpen} onClose={() => setQOpen(false)} />
      {confirmEl}
    </div>
  );
}

function SyncBadge() {
  const { online, syncNow, pendingOps } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="mt-2 flex items-center gap-2 rounded-xl bg-slate-900/5 dark:bg-white/10 px-3 py-2 text-xs font-semibold muted hover:bg-slate-900/10 dark:hover:bg-white/20 transition"
      onClick={() => { setBusy(true); void syncNow().finally(() => setBusy(false)); }}
      title="Sync now"
    >
      <Icon name="sync" className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
      {online ? (pendingOps > 0 ? `${pendingOps} change${pendingOps > 1 ? 's' : ''} pending` : 'Synced') : 'Offline — tap to retry'}
    </button>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const { navigate } = useApp();
  const items = NAV.filter((n) => !['home', 'today', 'tasks', 'calendar'].includes(n.key));
  return (
    <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-label="More sections">
      <div className="absolute inset-0 bg-slate-950/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 card rounded-b-none max-h-[80vh] overflow-y-auto animate-slide-up safe-bottom">
        <div className="sticky top-0 flex items-center justify-between px-5 py-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
          <h2 className="section-title">All sections</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 p-4 pt-0">
          {items.map((n) => (
            <button key={n.key} className="flex flex-col items-center gap-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 px-3 py-4 text-xs font-semibold"
              onClick={() => { navigate(n.key); onClose(); }}>
              <Icon name={n.icon} className="h-5 w-5 text-brand-600 dark:text-brand-300" />
              {n.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
