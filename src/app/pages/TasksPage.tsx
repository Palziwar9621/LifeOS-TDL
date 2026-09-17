// LifeOS — Tasks page with views, filters, search, drag reorder, bulk actions
import React, { useMemo, useState } from 'react';
import { Icon, EmptyState, Tabs, SelectInput, useConfirm } from '../../ui/components';
import { dbState, reorderTasks, updateTask, deleteTask, restoreTask, completeOccurrence, toggleRoutineCompletion } from '../../lib/db';
import { todayStr, addDays, isOverdue, diffDays } from '../../lib/dates';
import { occurrencesBetween, occurrenceDueDate, isOccurrenceDone } from '../../lib/recurrence';
import { PRIORITY_ORDER, PRIORITY_LABEL } from '../../lib/types';
import type { Task, Priority, TaskStatus } from '../../lib/types';
import { TaskRow } from '../TaskRow';
import { TaskEditor } from '../TaskEditor';
import { QuickAddModal } from '../quickadd';
import { RemindersPanel } from './RemindersPage';
import { RoutinesPanel } from './ProductivityPage';
import { useApp } from '../store';

type ViewKey = 'today' | 'tomorrow' | 'upcoming' | 'inbox' | 'overdue' | 'completed' | 'all' | 'routines' | 'reminders';
type SortKey = 'manual' | 'due' | 'priority' | 'created' | 'title';

interface Row {
  key: string;
  task: Task;
  occ?: string;
  title?: string;
  due_date?: string | null;
  due_time?: string | null;
}

export function TasksPage() {
  const { navigate, pageParams, toast, version } = useApp();
  const { confirm, confirmEl } = useConfirm();
  const [view, setView] = useState<ViewKey>((pageParams.view as ViewKey) ?? 'today');
  const [editing, setEditing] = useState<Task | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fProject, setFProject] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [sort, setSort] = useState<SortKey>('manual');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const s = dbState();

  const today = todayStr();

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const pushTask = (t: Task, occ?: string) => {
      if (occ) {
        const ov = t.occurrence_overrides?.[occ];
        out.push({
          key: `${t.id}:${occ}`, task: t, occ,
          title: ov?.title ?? t.title,
          due_date: occ,
          due_time: ov?.due_time ?? t.due_time,
        });
      } else {
        out.push({ key: t.id, task: t, due_date: t.due_date, due_time: t.due_time });
      }
    };

    for (const t of s.tasks) {
      if (t.deleted || t.archived) continue;

      if (t.recurrence) {
        const horizon = view === 'today' ? today : view === 'tomorrow' ? addDays(today, 1) : addDays(today, 60);
        const occs = occurrencesBetween(t, view === 'upcoming' ? today : addDays(today, -60), horizon);
        const visible = occs.filter((o) => !isOccurrenceDone(t, o));
        if (view === 'today') {
          occs.filter((o) => o === today && !isOccurrenceDone(t, o)).forEach((o) => pushTask(t, o));
        } else if (view === 'tomorrow') {
          occs.filter((o) => o === addDays(today, 1)).forEach((o) => pushTask(t, o));
        } else if (view === 'upcoming') {
          visible.filter((o) => o > today).forEach((o) => pushTask(t, o));
        } else {
          // inbox/all: show series as a single row on its next occurrence
          const next = visible[0];
          if (next) pushTask(t, next);
          else if (view === 'all') pushTask(t);
        }
        continue;
      }

      const dd = t.due_date;
      const isDone = t.status === 'completed' || t.status === 'cancelled';
      if (view === 'today' && dd === today && !isDone) pushTask(t);
      else if (view === 'tomorrow' && dd === addDays(today, 1) && !isDone) pushTask(t);
      else if (view === 'upcoming' && dd && dd > today && !isDone) pushTask(t);
      else if (view === 'inbox' && t.status === 'inbox' && !isDone) pushTask(t);
      else if (view === 'overdue' && isOverdue(t)) pushTask(t);
      else if (view === 'completed' && t.status === 'completed') pushTask(t);
      else if (view === 'all') pushTask(t);
    }

    // filters
    let filtered = out;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r) => r.title?.toLowerCase().includes(q) || r.task.notes?.toLowerCase().includes(q));
    }
    if (fPriority) filtered = filtered.filter((r) => r.task.priority === fPriority);
    if (fProject) filtered = filtered.filter((r) => r.task.project_id === fProject);
    if (fCategory) filtered = filtered.filter((r) => r.task.category_id === fCategory);
    if (fStatus) filtered = filtered.filter((r) => r.task.status === fStatus);

    // sort
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'due') {
        const ad = a.due_date ?? '9999';
        const bd = b.due_date ?? '9999';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.due_time ?? '').localeCompare(b.due_time ?? '');
      }
      if (sort === 'priority') return PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority];
      if (sort === 'created') return a.task.created_at < b.task.created_at ? 1 : -1;
      if (sort === 'title') return (a.title ?? '').localeCompare(b.title ?? '');
      return (a.task.sort_order ?? 0) - (b.task.sort_order ?? 0);
    });
    return sorted;
  }, [s.tasks.length, view, search, fPriority, fProject, fCategory, fStatus, sort, s.tasks, today, version]);

  const dragIndex = React.useRef<number | null>(null);

  const handleDragStart = (i: number) => (e: React.DragEvent) => {
    dragIndex.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDrop = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === i) return;
    const ids = rows.map((r) => r.task.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(i, 0, moved);
    void reorderTasks(ids);
    dragIndex.current = null;
  };

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const bulkComplete = async () => {
    for (const key of selected) {
      const row = rows.find((r) => r.key === key);
      if (!row) continue;
      if (row.occ) await completeOccurrence(row.task.id, row.occ);
      else await updateTask(row.task.id, { status: 'completed', completed_at: new Date().toISOString(), completed_at_date: todayStr() } as any);
    }
    toast(`${selected.size} task(s) completed`, 'success');
    setSelected(new Set());
    setBulkMode(false);
  };

  const bulkDelete = () => {
    confirm(`Delete ${selected.size} task(s)?`, 'This can be undone per-task only immediately after.', async () => {
      for (const key of selected) {
        const row = rows.find((r) => r.key === key);
        if (row && !row.occ) await deleteTask(row.task.id);
      }
      toast('Tasks deleted', 'info');
      setSelected(new Set());
      setBulkMode(false);
    });
  };

  const bulkMove = async (projectId: string) => {
    for (const key of selected) {
      const row = rows.find((r) => r.key === key);
      if (row) await updateTask(row.task.id, { project_id: projectId || null } as any);
    }
    toast('Tasks moved', 'success');
    setSelected(new Set());
    setBulkMode(false);
  };

  const VIEWS: { key: ViewKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'tomorrow', label: 'Tomorrow' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'inbox', label: 'Inbox' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'completed', label: 'Completed' },
    { key: 'all', label: 'All' },
    { key: 'routines', label: '🔁 Routines' },
    { key: 'reminders', label: '🔔 Reminders' },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="section-title text-2xl">Tasks</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input !pl-9 w-48" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className={`btn-sm btn ${bulkMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setBulkMode((v) => !v); setSelected(new Set()); }}>
            {bulkMode ? 'Cancel' : 'Select'}
          </button>
          <button className="btn-primary btn-sm" onClick={() => setQuickOpen(true)}>
            <Icon name="plus" className="h-4 w-4" /> New task
          </button>
        </div>
      </div>

      <Tabs tabs={VIEWS} active={view} onChange={(k) => setView(k as ViewKey)} />

      {view === 'reminders' ? (
        <div className="mt-3"><RemindersPanel /></div>
      ) : view === 'routines' ? (
        <div className="mt-3"><RoutinesPanel /></div>
      ) : (
      <>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <select className="input !w-auto !py-1.5" value={fPriority} onChange={(e) => setFPriority(e.target.value)} aria-label="Filter by priority">
          <option value="">All priorities</option>
          {(['urgent', 'high', 'medium', 'low'] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="input !w-auto !py-1.5" value={fProject} onChange={(e) => setFProject(e.target.value)} aria-label="Filter by project">
          <option value="">All projects</option>
          {s.projects.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input !w-auto !py-1.5" value={fCategory} onChange={(e) => setFCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {s.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {view === 'all' && (
          <select className="input !w-auto !py-1.5" value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {(['inbox', 'planned', 'in_progress', 'completed', 'cancelled'] as TaskStatus[]).map((st) => <option key={st} value={st}>{st.replace('_', ' ')}</option>)}
          </select>
        )}
        <select className="input !w-auto !py-1.5" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          <option value="manual">Sort: Manual</option>
          <option value="due">Sort: Due date</option>
          <option value="priority">Sort: Priority</option>
          <option value="created">Sort: Newest</option>
          <option value="title">Sort: Title</option>
        </select>
      </div>

      {bulkMode && selected.size > 0 && (
        <div className="card mt-3 flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <button className="btn-sm btn-secondary" onClick={() => void bulkComplete()}>Complete</button>
          <select className="input !w-auto !py-1" onChange={(e) => void bulkMove(e.target.value)} defaultValue="" aria-label="Move to project">
            <option value="" disabled>Move to project…</option>
            <option value="">No project</option>
            {s.projects.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn-sm btn-danger" onClick={bulkDelete}>Delete</button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {rows.length === 0 ? (
          <EmptyState icon="check" title="Nothing here" hint="No tasks match this view. Add one with the + button." />
        ) : (
          rows.map((row, i) => (
            <div key={row.key} className="flex items-center gap-2">
              {bulkMode && (
                <input type="checkbox" className="checkbox-tap" checked={selected.has(row.key)} onChange={() => toggleSelect(row.key)} aria-label={`Select ${row.title}`} />
              )}
              <div
                className="flex-1"
                draggable={sort === 'manual' && !bulkMode}
                onDragStart={handleDragStart(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop(i)}
              >
                <TaskRow
                  task={row.task}
                  onEdit={setEditing}
                  showProject
                  dragProps={sort === 'manual' && !bulkMode ? { draggable: true } : undefined}
                />
              </div>
            </div>
          ))
        )}
      </div>
      </>
      )}

      <TaskEditor task={editing} onClose={() => setEditing(null)} />
      <QuickAddModal open={quickOpen} initialKind="task" onClose={() => setQuickOpen(false)} />
      {confirmEl}
    </div>
  );
}
