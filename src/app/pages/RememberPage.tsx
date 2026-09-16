// LifeOS — Things to Remember (permanent knowledge, not tasks)
import React, { useState } from 'react';
import { Icon, Modal, EmptyState, useConfirm } from '../../ui/components';
import { dbState, createRememberItem, updateRememberItem, deleteRememberItem } from '../../lib/db';
import type { RememberItem } from '../../lib/types';
import { useApp } from '../store';

export function RememberPage() {
  const s = dbState();
  const { confirm, confirmEl } = useConfirm();
  const [editing, setEditing] = useState<RememberItem | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');

  const items = s.remember_items.filter((r) =>
    !r.deleted &&
    (!catFilter || r.category === catFilter) &&
    (!search || r.title.toLowerCase().includes(search.toLowerCase()) || r.content.toLowerCase().includes(search.toLowerCase()))
  );
  const pinned = items.filter((r) => r.pinned);
  const rest = items.filter((r) => !r.pinned);
  const cats = [...new Set(s.remember_items.filter((r) => !r.deleted).map((r) => r.category).filter(Boolean))] as string[];

  const Card = ({ item }: { item: RememberItem }) => (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-bold">{item.title}</h2>
        <div className="flex shrink-0 gap-0.5">
          <button className="btn-ghost btn-sm" aria-label={item.pinned ? 'Unpin' : 'Pin'}
            onClick={() => void updateRememberItem(item.id, { pinned: !item.pinned })}>
            <Icon name="pin" className={`h-4 w-4 ${item.pinned ? 'text-brand-600' : ''}`} />
          </button>
          <button className="btn-ghost btn-sm" aria-label={item.favorite ? 'Unfavorite' : 'Favorite'}
            onClick={() => void updateRememberItem(item.id, { favorite: !item.favorite })}>
            <Icon name="star" className={`h-4 w-4 ${item.favorite ? 'text-amber-500' : ''}`} />
          </button>
          <button className="btn-ghost btn-sm" aria-label="Edit" onClick={() => setEditing(item)}><Icon name="edit" className="h-4 w-4" /></button>
          <button className="btn-ghost btn-sm text-rose-500" aria-label="Delete"
            onClick={() => confirm('Delete item?', `“${item.title}” will be removed.`, () => void deleteRememberItem(item.id))}>
            <Icon name="trash" className="h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm muted">{item.content}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.category && <span className="chip chip-brand">{item.category}</span>}
        {item.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
        {item.reminder_freq && item.reminder_day && (
          <span className="chip chip-warn">🎂 {item.reminder_freq === 'yearly' ? 'Yearly' : 'Monthly'} · {dayLabel(item.reminder_day, item.reminder_freq)}</span>
        )}
      </div>
    </section>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm muted">Principles, rules, checklists and info you never want to lose.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> Add</button>
      </div>

      <UpcomingAnniversaries onEdit={(item) => setEditing(item)} />

      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input !w-56 !py-2" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {cats.length > 0 && (
          <select className="input !w-auto !py-2" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState icon="bookmark" title="Nothing saved yet" hint="Store principles, personal rules, and reference info here — it's not a task list."
          action={<button className="btn-primary mt-2" onClick={() => setEditing('new')}>Add your first item</button>} />
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide muted">📌 Pinned</h2>
              <div className="mb-5 grid gap-3 md:grid-cols-2">{pinned.map((i) => <Card key={i.id} item={i} />)}</div>
            </>
          )}
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide muted">All</h2>
          <div className="grid gap-3 md:grid-cols-2">{rest.map((i) => <Card key={i.id} item={i} />)}</div>
        </>
      )}

      {editing && <RememberEditor item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirmEl}
    </div>
  );
}

/** Next 3 upcoming anniversary alarms, sorted by days away. */
function UpcomingAnniversaries({ onEdit }: { onEdit: (i: RememberItem) => void }) {
  const s = dbState();
  const today = new Date();
  const fmt = (ymd: string, freq: string) => {
    const [, m, d] = ymd.split('-').map(Number);
    if (freq === 'monthly') return `day ${d} monthly`;
    // next occurrence of month/day
    let next = new Date(today.getFullYear(), m - 1, d);
    if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) next = new Date(today.getFullYear() + 1, m - 1, d);
    const days = Math.round((next.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
    const label = next.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return days === 0 ? 'TODAY' : days === 1 ? 'Tomorrow' : `${label} · in ${days}d`;
  };
  const upcoming = s.remember_items
    .filter((i) => !i.deleted && i.reminder_freq && i.reminder_day)
    .map((i) => ({ i, when: fmt(i.reminder_day!, i.reminder_freq!) }))
    .filter((x) => x.when !== 'day 31 monthly')
    .slice(0, 4);
  if (upcoming.length === 0) return null;
  return (
    <div className="card mb-4 p-3 flex flex-wrap items-center gap-2 border-l-4 border-l-amber-400">
      <span className="text-sm font-bold">🎂 Coming up:</span>
      {upcoming.map(({ i, when }) => (
        <button key={i.id} className="chip chip-warn" onClick={() => onEdit(i)} title="Click to edit">
          {i.title} · {when}
        </button>
      ))}
    </div>
  );
}

function dayLabel(ymd: string, freq: 'yearly' | 'monthly'): string {
  const [, m, d] = ymd.split('-').map(Number);
  const month = new Date(2000, m - 1, 1).toLocaleString(undefined, { month: 'short' });
  return freq === 'yearly' ? `${month} ${d}` : `day ${d} of every month`;
}

function RememberEditor({ item, onClose }: { item: RememberItem | null; onClose: () => void }) {
  const { toast } = useApp();
  const [title, setTitle] = useState(item?.title ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [remFreq, setRemFreq] = useState<'' | 'yearly' | 'monthly'>(item?.reminder_freq ?? '');
  const [remDay, setRemDay] = useState(item?.reminder_day ?? new Date().toISOString().slice(0, 10));
  const [remTime, setRemTime] = useState(item?.reminder_time ? item.reminder_time.slice(0, 5) : '09:00');
  const [remNote, setRemNote] = useState(item?.reminder_note ?? '');

  const save = async () => {
    if (!title.trim()) { toast('Give it a title', 'error'); return; }
    const payload = {
      title: title.trim(), content, category: category || null, tags,
      reminder_freq: (remFreq || null) as any,
      reminder_day: remFreq ? remDay : null,
      reminder_time: remFreq ? `${remTime}:00` : null,
      reminder_note: remFreq ? (remNote || null) : null,
    };
    if (item) await updateRememberItem(item.id, payload);
    else await createRememberItem(payload);
    toast(remFreq ? 'Saved — you\'ll get the alarm every time 🎂' : (item ? 'Saved' : 'Added'), 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={item ? 'Edit item' : 'New item'}>
      <div className="space-y-3">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Content</label>
          <textarea className="input min-h-40 font-mono text-[13px]" value={content} onChange={(e) => setContent(e.target.value)} placeholder={'Paste checklists, rules, key info…'} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Principle / Checklist / Info" />
          </div>
          <div>
            <label className="label">Tags</label>
            <TagInputLite tags={tags} onChange={setTags} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-900/10 dark:border-white/10 p-3">
          <label className="label">🎂 Anniversary alarm <span className="muted font-normal">(birthdays, bills, renewals)</span></label>
          <div className="grid grid-cols-3 gap-2">
            <select className="input" value={remFreq} onChange={(e) => setRemFreq(e.target.value as any)} aria-label="Anniversary frequency">
              <option value="">Off</option>
              <option value="yearly">Every year</option>
              <option value="monthly">Every month</option>
            </select>
            <input type="date" className="input" value={remDay} onChange={(e) => setRemDay(e.target.value)} disabled={!remFreq} aria-label="Anniversary date" />
            <input type="time" className="input" value={remTime} onChange={(e) => setRemTime(e.target.value)} disabled={!remFreq} aria-label="Alarm time" />
          </div>
          {remFreq && (
            <input className="input mt-2" value={remNote} onChange={(e) => setRemNote(e.target.value)}
              placeholder="Notification message (optional) — e.g. Buy a gift!" />
          )}
          {remFreq && (
            <p className="mt-1.5 text-xs muted">
              The alarm {remFreq === 'yearly' ? 'rings every year on this date' : 'rings on this day of every month'} at {remTime}.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function TagInputLite({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState('');
  const add = () => {
    const t = v.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setV('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10">
      {tags.map((t) => (
        <span key={t} className="chip chip-brand">#{t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}><Icon name="x" className="h-3 w-3" /></button>
        </span>
      ))}
      <input className="min-w-20 flex-1 bg-transparent text-sm outline-none" value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add} placeholder="Add tag…" />
    </div>
  );
}
