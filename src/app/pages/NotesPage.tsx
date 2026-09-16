// LifeOS — Notes
import React, { useState } from 'react';
import { Icon, Modal, EmptyState, useConfirm } from '../../ui/components';
import { dbState, createNote, updateNote, deleteNote } from '../../lib/db';
import type { Note } from '../../lib/types';
import { useApp } from '../store';

export function NotesPage() {
  const s = dbState();
  const { confirm, confirmEl } = useConfirm();
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');

  const notes = s.notes.filter((n) =>
    !n.deleted &&
    (view === 'archived' ? n.archived : !n.archived) &&
    (!folder || n.folder === folder) &&
    (!search || n.title.toLowerCase().includes(search.toLowerCase()) || n.content.toLowerCase().includes(search.toLowerCase()))
  );
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);
  const folders = [...new Set(s.notes.filter((n) => !n.deleted && n.folder).map((n) => n.folder!))];

  const NoteCard = ({ n }: { n: Note }) => {
    const linked = n.linked_task_id ? s.tasks.find((t) => t.id === n.linked_task_id)?.title
      : n.linked_project_id ? s.projects.find((p) => p.id === n.linked_project_id)?.name
      : n.linked_goal_id ? s.goals.find((g) => g.id === n.linked_goal_id)?.title : null;
    return (
      <section className={`card card-hover p-4 ${n.pinned ? 'ring-2 ring-brand-500/40' : ''}`} onClick={() => setEditing(n)}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 truncate font-bold">{n.title || 'Untitled note'}</h2>
          <div className="flex shrink-0 gap-0" onClick={(e) => e.stopPropagation()}>
            <button className="btn-ghost btn-sm" aria-label="Pin" onClick={() => void updateNote(n.id, { pinned: !n.pinned })}>
              <Icon name="pin" className={`h-4 w-4 ${n.pinned ? 'text-brand-600' : ''}`} />
            </button>
            <button className="btn-ghost btn-sm" aria-label="Favorite" onClick={() => void updateNote(n.id, { favorite: !n.favorite })}>
              <Icon name="star" className={`h-4 w-4 ${n.favorite ? 'text-amber-500' : ''}`} />
            </button>
          </div>
        </div>
        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm muted">{n.content}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {n.folder && <span className="chip"><Icon name="folder" className="h-3 w-3" /> {n.folder}</span>}
          {n.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
          {linked && <span className="chip chip-ok">↔ {linked}</span>}
          <span className="ml-auto text-[10px] muted">{new Date(n.updated_at).toLocaleDateString()}</span>
        </div>
      </section>
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Notes</h1>
          <p className="text-sm muted">Plain text, checklists, anything — synced everywhere.</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabsish view={view} onSet={setView} />
          <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> New note</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input !w-56 !py-2" placeholder="Search notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input !w-auto !py-2" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Filter by folder">
          <option value="">All folders</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {notes.length === 0 ? (
        <EmptyState icon="note" title={view === 'archived' ? 'Archive is empty' : 'No notes yet'} hint="Capture thoughts, meeting notes, checklists."
          action={<button className="btn-primary mt-2" onClick={() => setEditing('new')}>Write a note</button>} />
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide muted">📌 Pinned</h2>
              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{pinned.map((n) => <NoteCard key={n.id} n={n} />)}</div>
            </>
          )}
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide muted">Notes</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rest.map((n) => <NoteCard key={n.id} n={n} />)}</div>
        </>
      )}

      {editing && <NoteEditor note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirmEl}
    </div>
  );
}

function Tabsish({ view, onSet }: { view: 'active' | 'archived'; onSet: (v: 'active' | 'archived') => void }) {
  return (
    <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10">
      {(['active', 'archived'] as const).map((v) => (
        <button key={v} className={`px-3 py-2 text-sm font-semibold capitalize ${view === v ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
          onClick={() => onSet(v)}>{v}</button>
      ))}
    </div>
  );
}

function NoteEditor({ note, onClose }: { note: Note | null; onClose: () => void }) {
  const s = dbState();
  const { toast } = useApp();
  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [folder, setFolder] = useState(note?.folder ?? '');
  const [tags, setTags] = useState<string[]>(note?.tags ?? []);
  const [linkedTask, setLinkedTask] = useState(note?.linked_task_id ?? '');
  const [linkedProject, setLinkedProject] = useState(note?.linked_project_id ?? '');
  const [linkedGoal, setLinkedGoal] = useState(note?.linked_goal_id ?? '');
  const [archived, setArchived] = useState(note?.archived ?? false);

  const save = async () => {
    const payload = {
      title: title.trim(), content, folder: folder || null, tags,
      linked_task_id: linkedTask || null,
      linked_project_id: linkedProject || null,
      linked_goal_id: linkedGoal || null,
      archived,
    };
    if (note) await updateNote(note.id, payload);
    else await createNote(payload);
    toast(note ? 'Note saved' : 'Note created', 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={note ? 'Edit note' : 'New note'} wide>
      <div className="space-y-3">
        <input className="input !text-lg font-bold" placeholder="Note title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <textarea className="input min-h-56" placeholder="Start writing… (first line can be a checklist: “- [ ] item”)" value={content} onChange={(e) => setContent(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Folder</label>
            <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Personal / Work / …" />
          </div>
          <div>
            <label className="label">Tags</label>
            <TagInputLite tags={tags} onChange={setTags} />
          </div>
          <div>
            <label className="label">Link to task</label>
            <select className="input" value={linkedTask} onChange={(e) => setLinkedTask(e.target.value)}>
              <option value="">None</option>
              {s.tasks.filter((t) => !t.deleted).slice(0, 200).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Link to project</label>
            <select className="input" value={linkedProject} onChange={(e) => setLinkedProject(e.target.value)}>
              <option value="">None</option>
              {s.projects.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Link to goal</label>
            <select className="input" value={linkedGoal} onChange={(e) => setLinkedGoal(e.target.value)}>
              <option value="">None</option>
              {s.goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox-tap" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Archived (hidden from main list)
        </label>
        <div className="flex justify-between gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          {note ? (
            <button className="btn-danger btn-sm" onClick={async () => { await deleteNote(note.id); toast('Note deleted', 'success'); onClose(); }}>
              <Icon name="trash" className="h-4 w-4" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => void save()}>Save note</button>
          </div>
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
