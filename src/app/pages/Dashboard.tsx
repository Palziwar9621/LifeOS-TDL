// LifeOS — Home dashboard
import React, { useMemo, useState } from 'react';
import { Icon, EmptyState, ProgressBar, useConfirm } from '../../ui/components';
import { dbState, subtasksOf, completeTask, uncompleteTask, getProfile } from '../../lib/db';
import { todayStr, relativeDay, fmtTime, isOverdue, weekdayNames, parseDateStr } from '../../lib/dates';
import { occurrencesBetween, isOccurrenceDone } from '../../lib/recurrence';
import { TaskRow } from '../TaskRow';
import { TaskEditor } from '../TaskEditor';
import { QuickAddModal } from '../quickadd';
import { useApp } from '../store';
import type { Task } from '../../lib/types';

export function Dashboard() {
  const { navigate, session, version } = useApp();
  const s = dbState();
  const today = todayStr();
  const [editing, setEditing] = useState<Task | null>(null);
  const [quickKind, setQuickKind] = useState<null | 'task' | 'note' | 'reminder' | 'project' | 'goal'>(null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = getProfile()?.username ?? '';

  const todayTasks = s.tasks.filter((t) => {
    if (t.deleted || t.archived) return false;
    if (t.recurrence) return false; // handled via occurrences below
    const done = t.status === 'completed' || t.status === 'cancelled';
    return t.due_date === today && !done;
  });
  const todayRec = s.tasks.filter((t) => {
    if (t.deleted || t.archived || !t.recurrence) return false;
    return occurrencesBetween(t, today, today).some((o) => o === today && !isOccurrenceDone(t, o));
  });
  const doneTodayCount = doneTodayNonRec(s, today) +
    s.tasks.filter((t) => t.recurrence && !t.deleted && !t.archived && t.completed_occurrences?.[today]).length;
  const overdue = s.tasks.filter((t) => !t.deleted && !t.archived && isOverdue(t) && t.status !== 'completed' && !t.recurrence);
  const upcoming = s.tasks
    .filter((t) => !t.deleted && !t.archived && !t.recurrence && t.due_date && t.due_date > today && t.status !== 'completed')
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
    .slice(0, 5);

  const todayBlocks = s.schedule_blocks
    .filter((b) => !b.deleted && b.weekday === parseDateStr(today).getDay())
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const activeProjects = s.projects.filter((p) => p.status === 'active' && !p.archived).slice(0, 3);
  const activeGoals = s.goals.filter((g) => g.status === 'active').slice(0, 3);
  const importantReminders = s.reminders
    .filter((r) => !r.done && !r.deleted && r.important)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
    .slice(0, 3);

  const doneNonRec = doneTodayNonRec(s, today);
  const doneRec = s.tasks.filter((t) => t.recurrence && !t.deleted && !t.archived && t.completed_occurrences?.[today]).length;
  const totalToday = todayTasks.length + todayRec.length + doneNonRec + doneRec;
  const remaining = todayTasks.length + todayRec.length;
  const progress = totalToday === 0 ? 0 : Math.round(((doneNonRec + doneRec) / totalToday) * 100);

  const quickLinks: { label: string; icon: string; kind: 'task' | 'note' | 'reminder' | 'project' | 'goal' | 'schedule'; color: string }[] = [
    { label: 'Task', icon: 'check', kind: 'task', color: 'bg-brand-600' },
    { label: 'Note', icon: 'note', kind: 'note', color: 'bg-sky-600' },
    { label: 'Reminder', icon: 'bell', kind: 'reminder', color: 'bg-amber-600' },
    { label: 'Project', icon: 'folder', kind: 'project', color: 'bg-emerald-600' },
    { label: 'Goal', icon: 'target', kind: 'goal', color: 'bg-violet-600' },
    { label: 'Schedule', icon: 'calendar', kind: 'schedule', color: 'bg-rose-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="card overflow-hidden">
        <div className="bg-gradient-to-r from-brand-600 to-violet-600 p-6 text-white md:p-8">
          <p className="text-sm font-medium text-white/80">{greeting}{name ? ', ' + name : ''} — {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">
            {totalToday === 0 ? 'A clear day ahead.' : remaining === 0 && totalToday > 0 ? 'All done for today 🎉' : `${remaining} task${remaining === 1 ? '' : 's'} to go`}
          </h1>
          <div className="mt-4 max-w-md">
            <div className="mb-1.5 flex justify-between text-xs font-semibold text-white/90">
              <span>Today's Progress</span>
              <span>{progress}%{totalToday > 0 ? ` · ${doneTodayCount}/${totalToday}` : ''}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-slate-900/5 dark:divide-white/10 md:grid-cols-6">
          {quickLinks.map((q) => (
            <button key={q.label} className="group flex flex-col items-center gap-1.5 px-2 py-4 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
              onClick={() => q.kind === 'schedule' ? navigate('weekly') : setQuickKind(q.kind)}>
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${q.color} text-white shadow-sm`}>
                <Icon name={q.icon} className="h-4.5 w-4.5" />
              </span>
              + {q.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Today's tasks */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Today's tasks</h2>
              <button className="text-sm font-semibold text-brand-600 dark:text-brand-300" onClick={() => navigate('today')}>View all →</button>
            </div>
            {todayTasks.length + todayRec.length === 0 ? (
              <EmptyState icon="check" title="Nothing scheduled" hint="Enjoy the calm — or add a task with + above." />
            ) : (
              <div className="space-y-2">
                {todayRec.map((t) => (
                  <TaskRow key={t.id + ':r'} task={t} onEdit={setEditing} showProject />
                ))}
                {todayTasks.slice(0, 8).map((t) => (
                  <TaskRow key={t.id} task={t} onEdit={setEditing} showProject />
                ))}
              </div>
            )}
          </section>

          {/* Overdue */}
          {overdue.length > 0 && (
            <section className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title text-rose-600 dark:text-rose-400">Overdue ({overdue.length})</h2>
                <button className="text-sm font-semibold text-brand-600 dark:text-brand-300" onClick={() => navigate('tasks', { view: 'overdue' })}>Review →</button>
              </div>
              <div className="space-y-2">
                {overdue.slice(0, 4).map((t) => <TaskRow key={t.id} task={t} onEdit={setEditing} />)}
              </div>
            </section>
          )}

          {/* Upcoming */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Upcoming deadlines</h2>
              <button className="text-sm font-semibold text-brand-600 dark:text-brand-300" onClick={() => navigate('tasks', { view: 'upcoming' })}>View all →</button>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm muted">No upcoming deadlines. 🌤️</p>
            ) : (
              <ul className="divide-y divide-slate-900/5 dark:divide-white/10">
                {upcoming.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="truncate text-sm font-medium">{t.title}</span>
                    <span className="chip shrink-0">{relativeDay(t.due_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {/* Today's schedule */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Today's schedule</h2>
              <button className="text-sm font-semibold text-brand-600 dark:text-brand-300" onClick={() => navigate('weekly')}>Plan →</button>
            </div>
            {todayBlocks.length === 0 ? (
              <p className="text-sm muted">No time blocks for today.</p>
            ) : (
              <ul className="space-y-2">
                {todayBlocks.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5" style={{ borderLeft: `3px solid ${b.color}` }}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{b.title}</p>
                      <p className="text-xs muted">{fmtTime(b.start_time)} – {fmtTime(b.end_time)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Projects & goals */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Active work</h2>
            </div>
            <div className="space-y-3">
              {activeProjects.map((p) => {
                const tasks = s.tasks.filter((t) => t.project_id === p.id && !t.deleted && t.status !== 'cancelled');
                const done = tasks.filter((t) => t.status === 'completed').length;
                const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
                return (
                  <button key={p.id} className="block w-full text-left" onClick={() => navigate('projects')}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="text-xs muted">{pct}%</span>
                    </div>
                    <ProgressBar value={pct} color={p.color} />
                  </button>
                );
              })}
              {activeGoals.map((g) => {
                const ms = s.goal_milestones.filter((m) => m.goal_id === g.id);
                const pct = ms.length ? Math.round((ms.filter((m) => m.done).length / ms.length) * 100) : g.progress;
                return (
                  <button key={g.id} className="block w-full text-left" onClick={() => navigate('goals')}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="truncate font-semibold">{g.title}</span>
                      <span className="text-xs muted">{pct}%</span>
                    </div>
                    <ProgressBar value={pct} color={g.color} />
                  </button>
                );
              })}
              {activeProjects.length + activeGoals.length === 0 && (
                <p className="text-sm muted">No active projects or goals yet.</p>
              )}
            </div>
          </section>

          {/* Reminders */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Important reminders</h2>
              <button className="text-sm font-semibold text-brand-600 dark:text-brand-300" onClick={() => navigate('reminders')}>All →</button>
            </div>
            {importantReminders.length === 0 ? (
              <p className="text-sm muted">No important reminders.</p>
            ) : (
              <ul className="space-y-2">
                {importantReminders.map((r) => (
                  <li key={r.id} className="flex items-center gap-2.5 text-sm">
                    <Icon name="bell" className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="truncate">{r.title}</span>
                    <span className="chip ml-auto shrink-0">
                      {new Date(r.snoozed_until ?? r.due_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <TaskEditor task={editing} onClose={() => setEditing(null)} />
      <QuickAddModal open={quickKind !== null} initialKind={quickKind ?? 'task'} onClose={() => setQuickKind(null)} />
    </div>
  );
}

/** Non-recurring tasks completed today (completed earlier, so not in todayTasks). */
function doneTodayNonRec(s: ReturnType<typeof dbState>, today: string): number {
  return s.tasks.filter((t) =>
    !t.deleted && !t.archived && !t.recurrence &&
    t.status === 'completed' &&
    (t.completed_at_date === today || (t.due_date === today && t.completed_at_date !== undefined && t.completed_at_date !== null && t.completed_at_date <= today))
  ).length;
}
