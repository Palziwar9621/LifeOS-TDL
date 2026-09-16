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
      </div>
    </section>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Things to Remember</h1>
          <p className="text-sm muted">Principles, rules, checklists and info you never want to lose.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> Add</button>
      </div>

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

function RememberEditor({ item, onClose }: { item: RememberItem | null; onClose: () => void }) {
  const { toast } = useApp();
  const [title, setTitle] = useState(item?.title ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);

  const save = async () => {
    if (!title.trim()) { toast('Give it a title', 'error'); return; }
    const payload = { title: title.trim(), content, category: category || null, tags };
    if (item) await updateRememberItem(item.id, payload);
    else await createRememberItem(payload);
    toast(item ? 'Saved' : 'Added', 'success');
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
