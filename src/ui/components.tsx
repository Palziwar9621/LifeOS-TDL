// LifeOS — shared UI primitives
import React, { useEffect, useRef, useState } from 'react';
import { PRIORITY_LABEL, PRIORITY_ICON, STATUS_LABEL } from '../lib/types';
import type { Priority, TaskStatus } from '../lib/types';

// ---------------------------------------------------------------
export function Icon({ name, className = 'h-5 w-5', size }: { name: string; className?: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    sun: <><circle cx="12" cy="12" r="4" strokeWidth="1.8" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.3 11.3 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeWidth="1.8" strokeLinecap="round" /></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" strokeWidth="1.8" strokeLinejoin="round" />,
    check: <path d="m4 12.5 5 5L20 6.5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
    plus: <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />,
    search: <><circle cx="11" cy="11" r="7" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" strokeWidth="1.8" strokeLinecap="round" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" strokeWidth="1.8" /><path d="M3 9h18M8 3v4M16 3v4" strokeWidth="1.8" strokeLinecap="round" /></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeWidth="1.8" strokeLinejoin="round" />,
    target: <><circle cx="12" cy="12" r="9" strokeWidth="1.8" /><circle cx="12" cy="12" r="5" strokeWidth="1.8" /><circle cx="12" cy="12" r="1.4" strokeWidth="1.8" /></>,
    bulb: <path d="M9 18h6m-5 3h4m-2-21a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V15h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 0Z" strokeWidth="1.8" strokeLinejoin="round" transform="translate(0,2)" />,
    bookmark: <path d="M6 4h12v17l-6-4-6 4V4Z" strokeWidth="1.8" strokeLinejoin="round" />,
    chart: <path d="M4 20V10m6 10V4m6 16v-7" strokeWidth="2" strokeLinecap="round" />,
    settings: <><circle cx="12" cy="12" r="3" strokeWidth="1.8" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1" strokeWidth="1.8" strokeLinecap="round" /></>,
    clock: <><circle cx="12" cy="12" r="9" strokeWidth="1.8" /><path d="M12 7v5l3 3" strokeWidth="1.8" strokeLinecap="round" /></>,
    inbox: <><path d="M3 12h5l2 3h4l2-3h5" strokeWidth="1.8" strokeLinejoin="round" /><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" strokeWidth="1.8" /></>,
    list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth="2" strokeLinecap="round" />,
    note: <path d="M6 3h9l5 5v13H6V3Z" strokeWidth="1.8" strokeLinejoin="round" />,
    bell: <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Zm4 9a2 2 0 0 0 4 0" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />,
    focus: <><circle cx="12" cy="12" r="9" strokeWidth="1.8" /><circle cx="12" cy="12" r="4.5" strokeWidth="1.8" /><circle cx="12" cy="12" r="1" strokeWidth="2" /></>,
    trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h10l1-13" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    edit: <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" strokeWidth="1.8" strokeLinejoin="round" />,
    sync: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    logout: <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3m5-4 4-4-4-4m4 4H10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    user: <><circle cx="12" cy="8" r="4" strokeWidth="1.8" /><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6" strokeWidth="1.8" strokeLinecap="round" /></>,
    star: <path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.1L12 17l-5.6 3 1.2-6.1L3 9.6l6.3-.8L12 3Z" strokeWidth="1.8" strokeLinejoin="round" />,
    pin: <path d="M12 17v5m-5-9.5 1.5-6A2 2 0 0 1 10.4 5h3.2a2 2 0 0 1 1.9 1.5l1.5 6" strokeWidth="1.8" strokeLinecap="round" />,
    x: <path d="M6 6l12 12M18 6 6 18" strokeWidth="2" strokeLinecap="round" />,
    chevronL: <path d="m14 6-6 6 6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    chevronR: <path d="m10 6 6 6-6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    chevronD: <path d="m6 10 6 6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    more: <path d="M12 5.5h.01M12 12h.01M12 18.5h.01" strokeWidth="2.4" strokeLinecap="round" />,
    play: <path d="M8 5.5v13l11-6.5-11-6.5Z" strokeWidth="1.8" strokeLinejoin="round" />,
    pause: <path d="M9 5v14M15 5v14" strokeWidth="2.2" strokeLinecap="round" />,
    refresh: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    offline: <path d="M2 2l20 20M8.5 16.4A5 5 3 0 1 12 8h.5M5 12a7 7 0 0 1 1.9-4.8M19 12a7 7 0 0 0-3.1-5.8M12 20h.01" strokeWidth="1.8" strokeLinecap="round" />,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden="true" width={size} height={size}>
      {paths[name] ?? paths.list}
    </svg>
  );
}

// ---------------------------------------------------------------
export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className={`card relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-2xl animate-slide-up`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-900/5 dark:border-white/10 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-5 py-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', onConfirm, onCancel, danger = true }: {
  open: boolean; title: string; message: string; confirmLabel?: string;
  onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm muted mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------
export function useConfirm() {
  const [state, setState] = useState<{ open: boolean; title: string; message: string; confirmLabel: string; danger: boolean; onConfirm: () => void } | null>(null);
  const confirm = (title: string, message: string, onConfirm: () => void, opts?: { confirmLabel?: string; danger?: boolean }) => {
    setState({ open: true, title, message, onConfirm, confirmLabel: opts?.confirmLabel ?? 'Delete', danger: opts?.danger ?? true });
  };
  const el = state ? (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      danger={state.danger}
      onConfirm={() => { state.onConfirm(); setState(null); }}
      onCancel={() => setState(null)}
    />
  ) : null;
  return { confirm, confirmEl: el };
}

// ---------------------------------------------------------------
export function PriorityChip({ p }: { p: Priority }) {
  const styles: Record<Priority, string> = {
    low: 'chip chip-ok',
    medium: 'chip chip-warn',
    high: 'chip chip-danger',
    urgent: 'chip bg-rose-600 text-white ring-rose-700',
  };
  return <span className={styles[p]}>{PRIORITY_ICON[p]} {PRIORITY_LABEL[p]}</span>;
}

export function StatusChip({ s }: { s: TaskStatus }) {
  const styles: Record<TaskStatus, string> = {
    inbox: 'chip', planned: 'chip chip-brand', in_progress: 'chip chip-warn',
    completed: 'chip chip-ok', cancelled: 'chip',
  };
  return <span className={styles[s]}>{STATUS_LABEL[s]}</span>;
}

export function ProgressBar({ value, color, label }: { value: number; color?: string; label?: string }) {
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-xs muted">
          <span>{label}</span><span>{Math.round(value)}%</span>
        </div>
      )}
      <div className="progress-track" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color ?? undefined }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-slate-200/60 dark:bg-slate-800/60 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
            active === t.key
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
          onClick={() => onChange(t.key)}
          aria-pressed={active === t.key}
        >
          {t.label}
          {t.badge != null && t.badge > 0 && (
            <span className="ml-1.5 inline-flex items-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return <Tabs tabs={options} active={value} onChange={onChange} />;
}

// ---------------------------------------------------------------
export function EmptyState({ icon = 'list', title, hint, action }: {
  icon?: string; title: string; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {hint && <p className="max-w-sm text-sm muted">{hint}</p>}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------
export function Avatar({ url, name, size = 40 }: { url?: string | null; name?: string | null; size?: number }) {
  const [err, setErr] = useState(false);
  const initials = (name ?? 'U').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (url && !err) {
    return <img src={url} alt={name ?? 'Profile'} className="rounded-full object-cover ring-1 ring-slate-900/10 dark:ring-white/10" style={{ width: size, height: size }} onError={() => setErr(true)} />;
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-600 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

// ---------------------------------------------------------------
export function TagInput({ tags, onChange, placeholder = 'Add tag…' }: {
  tags: string[]; onChange: (t: string[]) => void; placeholder?: string;
}) {
  const [val, setVal] = useState('');
  const add = () => {
    const t = val.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setVal('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white dark:bg-slate-800 px-3 py-2 ring-1 ring-slate-900/10 dark:ring-white/10">
      {tags.map((t) => (
        <span key={t} className="chip chip-brand">
          #{t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="ml-0.5 hover:text-brand-900">
            <Icon name="x" className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(); }
          if (e.key === 'Backspace' && !val && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={add}
        placeholder={placeholder}
      />
    </div>
  );
}

// ---------------------------------------------------------------
export function SelectInput<T extends string>(props: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string; allowEmpty?: string;
}) {
  const { value, onChange, options, label, allowEmpty } = props;
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------
export function InlineAdd({ placeholder, onAdd, addLabel = 'Add' }: {
  placeholder: string; onAdd: (title: string) => void; addLabel?: string;
}) {
  const [val, setVal] = useState('');
  const submit = () => {
    const v = val.trim();
    if (!v) return;
    onAdd(v);
    setVal('');
  };
  return (
    <div className="flex gap-2">
      <input
        className="input flex-1"
        value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      <button className="btn-primary" onClick={submit}>{addLabel}</button>
    </div>
  );
}

// ---------------------------------------------------------------
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin text-brand-600 ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <span className="flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-sm shadow-brand-600/30"
        style={{ width: size, height: size, fontSize: size * 0.55 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: size * 0.62, height: size * 0.62 }} aria-hidden="true">
          <path d="M4 12.5 9.5 18 20 6.5" />
        </svg>
      </span>
      <span className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">LifeOS</span>
    </span>
  );
}
