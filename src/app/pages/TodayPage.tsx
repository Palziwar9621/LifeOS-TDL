// LifeOS — Today page: the daily focus list
import React, { useMemo, useState } from 'react';
import { Icon, EmptyState } from '../../ui/components';
import { dbState, createTask, reorderTasks, updateTask } from '../../lib/db';
import { todayStr, addDays, isOverdue, relativeDay } from '../../lib/dates';
import { occurrencesBetween, isOccurrenceDone } from '../../lib/recurrence';
import { parseQuickAdd } from '../../lib/quickadd';
import type { Task } from '../../lib/types';
import { TaskRow } from '../TaskRow';
import { TaskEditor } from '../TaskEditor';
import { useApp } from '../store';

interface Row { key: string; task: Task; occ?: string }

export function TodayPage() {
  const { version } = useApp();
  const s = dbState();
  const today = todayStr();
  const [editing, setEditing] = useState<Task | null>(null);
  const [quick, setQuick] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const { rows, doneRows } = useMemo<{ rows: Row[]; doneRows: Row[] }>(() => {
    const rows: Row[] = [];
    const doneRows: Row[] = [];
    for (const t of s.tasks) {
      if (t.deleted || t.archived) continue;
      if (t.recurrence) {
        if (occurrencesBetween(t, today, today).includes(today) && !isOccurrenceDone(t, today)) {
          rows.push({ key: t.id + ':' + today, task: t, occ: today });
        } else if (isOccurrenceDone(t, today)) {
          doneRows.push({ key: t.id + ':' + today, task: t, occ: today });
        }
        continue;
      }
      const isDone = t.status === 'completed';
      if (t.due_date === today && !isDone) rows.push({ key: t.id, task: t });
      else if (t.due_date === today && isDone) doneRows.push({ key: t.id, task: t });
    }
    rows.sort((a, b) => a.task.sort_order - b.task.sort_order);
    return { rows, doneRows };
  }, [s.tasks, today, version]);

  const overdue = s.tasks.filter((t) => !t.deleted && !t.archived && !t.recurrence && isOverdue(t));
  const tomorrowCount = s.tasks.filter((t) => !t.deleted && t.due_date === addDays(today, 1) && t.status !== 'completed').length;

  const addQuick = async () => {
    const raw = quick.trim();
    if (!raw) return;
    const p = parseQuickAdd(raw);
    await createTask({
      title: p.title,
      due_date: p.due_date ?? today,
      due_time: p.due_time,
      priority: p.priority ?? 'medium',
      recurrence: p.recurrence,
      recurrence_days: p.recurrence_days,
    });
    setQuick('');
  };

  const handleDragStart = (i: number) => (e: React.DragEvent) => {
    setDragFrom(i);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDrop = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragFrom === null || dragFrom === i) return;
    const ids = rows.map((r) => r.task.id);
    const [moved] = ids.splice(dragFrom, 1);
    ids.splice(i, 0, moved);
    void reorderTasks(ids);
    setDragFrom(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Today</h1>
          <p className="text-sm muted">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {rows.filter((r) => !r.occ).length + rows.filter((r) => r.occ).length} open · {doneRows.length} done
          </p>
        </div>
      </div>

      {/* Quick add */}
      <div className="card p-3">
        <div className="flex gap-2">
          <Icon name="plus" className="ml-1.5 mt-3 h-4 w-4 text-brand-600" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="Add a task for today… (try “Gym at 6 pm every mon,wed,fri”)"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addQuick(); }}
          />
          {quick && <button className="btn-primary btn-sm" onClick={() => void addQuick()}>Add</button>}
        </div>
      </div>

      {/* Overdue strip */}
      {overdue.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">Overdue · {overdue.length}</h2>
          <div className="space-y-2">
            {overdue.slice(0, 3).map((t) => <TaskRow key={t.id} task={t} onEdit={setEditing} />)}
          </div>
          {overdue.length > 3 && (
            <button className="mt-2 text-sm font-semibold text-brand-600 dark:text-brand-300" onClick={() => window.dispatchEvent(new CustomEvent('nav-tasks-overdue'))}>
              Show all {overdue.length} overdue →
            </button>
          )}
        </section>
      )}

      {/* Main list */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide muted">Scheduled for today</h2>
        {rows.length === 0 ? (
          <EmptyState icon="sun" title="Today is clear" hint="Add your first task above — type it naturally with a time." />
        ) : (
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div
                key={row.key}
                draggable
                onDragStart={handleDragStart(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop(i)}
              >
                <TaskRow task={row.task} onEdit={setEditing} dragProps={{ draggable: true }} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Completed today */}
      {doneRows.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide muted">Completed today · {doneRows.length}</h2>
          <div className="space-y-2 opacity-70">
            {doneRows.map((row) => (
              <TaskRow key={row.key} task={{ ...row.task, status: 'completed' }} onEdit={setEditing} />
            ))}
          </div>
        </section>
      )}

      <TaskEditor task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
