// LifeOS — Global search across everything
import React, { useMemo, useState } from 'react';
import { Icon, EmptyState } from '../../ui/components';
import { dbState } from '../../lib/db';
import { useApp } from '../store';
import type { Task } from '../../lib/types';
import { TaskEditor } from '../TaskEditor';

interface Hit { kind: string; label: string; detail: string; id: string; navigateTo: string; task?: Task }

export function SearchPage() {
  const { navigate, version } = useApp();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const s = dbState();

  const results = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const hits: Hit[] = [];
    const match = (...fields: (string | null | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(query));

    for (const t of s.tasks) {
      if (!t.deleted && match(t.title, t.notes)) {
        hits.push({ kind: 'Task', label: t.title, detail: t.notes?.slice(0, 60) ?? '', id: t.id, navigateTo: 'tasks', task: t });
      }
    }
    for (const p of s.projects) {
      if (match(p.name, p.description)) hits.push({ kind: 'Project', label: p.name, detail: p.description?.slice(0, 60) ?? '', id: p.id, navigateTo: 'projects' });
    }
    for (const g of s.goals) {
      if (match(g.title, g.description)) hits.push({ kind: 'Goal', label: g.title, detail: g.description?.slice(0, 60) ?? '', id: g.id, navigateTo: 'goals' });
    }
    for (const n of s.notes) {
      if (!n.deleted && match(n.title, n.content)) hits.push({ kind: 'Note', label: n.title || '(untitled)', detail: n.content.slice(0, 60), id: n.id, navigateTo: 'notes' });
    }
    for (const i of s.ideas) {
      if (!i.deleted && match(i.title, i.description, i.why)) hits.push({ kind: 'Idea', label: i.title, detail: i.description?.slice(0, 60) ?? '', id: i.id, navigateTo: 'ideas' });
    }
    for (const r of s.remember_items) {
      if (!r.deleted && match(r.title, r.content)) hits.push({ kind: 'Remember', label: r.title, detail: r.content.slice(0, 60), id: r.id, navigateTo: 'remember' });
    }
    for (const b of s.schedule_blocks) {
      if (!b.deleted && b.title.toLowerCase().includes(query)) hits.push({ kind: 'Schedule', label: b.title, detail: b.notes ?? '', id: b.id, navigateTo: 'weekly' });
    }
    for (const r of s.reminders) {
      if (!r.deleted && match(r.title, r.notes)) hits.push({ kind: 'Reminder', label: r.title, detail: r.notes ?? '', id: r.id, navigateTo: 'reminders' });
    }
    return hits.slice(0, 80);
  }, [q, s, version]);

  const KIND_ICON: Record<string, string> = {
    Task: 'check', Project: 'folder', Goal: 'target', Note: 'note',
    Idea: 'bulb', Remember: 'bookmark', Schedule: 'clock', Reminder: 'bell',
  };
  const KIND_PAGE: Record<string, any> = {
    Task: 'tasks', Project: 'projects', Goal: 'goals', Note: 'notes',
    Idea: 'ideas', Remember: 'remember', Schedule: 'weekly', Reminder: 'reminders',
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight">Search</h1>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
        <input
          className="input !py-3 !pl-11 !text-base"
          placeholder="Search tasks, projects, goals, notes, ideas…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      {q && (
        <p className="mt-3 text-sm muted">{results.length} result{results.length === 1 ? '' : 's'}</p>
      )}

      {results.length === 0 && q ? (
        <EmptyState icon="search" title="Nothing found" hint={`No matches for “${q}”. Try a different word.`} />
      ) : (
        <div className="mt-4 space-y-2">
          {results.map((h) => (
            <button key={h.kind + h.id} className="card card-hover flex w-full items-center gap-3 px-4 py-3 text-left"
              onClick={() => (h.task ? setEditing(h.task) : navigate(KIND_PAGE[h.kind] ?? 'home'))}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300">
                <Icon name={KIND_ICON[h.kind] ?? 'search'} className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{h.label}</span>
                {h.detail && <span className="block truncate text-xs muted">{h.detail}</span>}
              </span>
              <span className="chip shrink-0">{h.kind}</span>
            </button>
          ))}
        </div>
      )}

      <TaskEditor task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
