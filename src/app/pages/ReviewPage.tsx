// LifeOS — Daily Review & Weekly Review
import React, { useState } from 'react';
import { Icon, EmptyState, useConfirm } from '../../ui/components';
import { dbState, updateTask, completeTask } from '../../lib/db';
import { todayStr, addDays, startOfWeek, fmtDate, relativeDay, isOverdue, weekdayShort } from '../../lib/dates';
import { TaskRow } from '../TaskRow';
import { TaskEditor } from '../TaskEditor';
import type { Task } from '../../lib/types';

export function ReviewPage() {
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily');
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Review</h1>
        <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10">
          {(['daily', 'weekly'] as const).map((t) => (
            <button key={t} className={`px-4 py-2 text-sm font-semibold capitalize ${tab === t ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
              onClick={() => setTab(t)}>{t} review</button>
          ))}
        </div>
      </div>
      {tab === 'daily' ? <DailyReview /> : <WeeklyReview />}
    </div>
  );
}

function DailyReview() {
  const s = dbState();
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const [editing, setEditing] = useState<Task | null>(null);

  const completedToday = s.tasks.filter((t) => t.completed_at_date === today);
  const incompleteToday = s.tasks.filter((t) => !t.deleted && t.due_date === today && t.status !== 'completed' && t.status !== 'cancelled' && !t.recurrence);
  const overdue = s.tasks.filter((t) => !t.deleted && !t.recurrence && isOverdue(t));
  const tomorrowTasks = s.tasks.filter((t) => !t.deleted && t.due_date === tomorrow && t.status !== 'completed');
  const upcoming = s.tasks
    .filter((t) => !t.deleted && t.due_date && t.due_date > tomorrow && t.status !== 'completed' && !t.recurrence)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
    .slice(0, 8);

  const pushToTomorrow = (id: string) => {
    void updateTask(id, { due_date: tomorrow } as any);
  };

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="section-title mb-1">How did today go?</h2>
        <p className="text-sm muted">
          {completedToday.length === 0
            ? 'Nothing completed yet — there\'s still time, or carry it forward kindly.'
            : `You completed ${completedToday.length} task${completedToday.length === 1 ? '' : 's'} today. Nice.`}
        </p>
      </div>

      <ReviewSection title="Completed today" count={completedToday.length} empty="Nothing completed today.">
        {completedToday.map((t) => <TaskRow key={t.id} task={t} onEdit={setEditing} />)}
      </ReviewSection>

      <ReviewSection title="Incomplete — still open" count={incompleteToday.length} empty="Everything scheduled for today is done.">
        {incompleteToday.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <div className="flex-1"><TaskRow task={t} onEdit={setEditing} /></div>
            <button className="btn-secondary btn-sm shrink-0" title="Reschedule to tomorrow" onClick={() => pushToTomorrow(t.id)}>
              → Tomorrow
            </button>
          </div>
        ))}
      </ReviewSection>

      <ReviewSection title="Overdue" count={overdue.length} empty="No overdue tasks. Wonderful.">
        {overdue.slice(0, 6).map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <div className="flex-1"><TaskRow task={t} onEdit={setEditing} /></div>
            <button className="btn-secondary btn-sm shrink-0" onClick={() => void updateTask(t.id, { due_date: today } as any)}>→ Today</button>
            <button className="btn-secondary btn-sm shrink-0" onClick={() => void updateTask(t.id, { due_date: tomorrow } as any)}>→ Tomorrow</button>
          </div>
        ))}
      </ReviewSection>

      <ReviewSection title="Tomorrow" count={tomorrowTasks.length} empty="Tomorrow is clear so far.">
        {tomorrowTasks.map((t) => <TaskRow key={t.id} task={t} onEdit={setEditing} />)}
      </ReviewSection>

      <ReviewSection title="Upcoming deadlines" count={upcoming.length} empty="">
        <ul className="divide-y divide-slate-900/5 dark:divide-white/10">
          {upcoming.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm">
              <span className="truncate">{t.title}</span>
              <span className="chip shrink-0">{relativeDay(t.due_date)}</span>
            </li>
          ))}
        </ul>
      </ReviewSection>

      <TaskEditor task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function WeeklyReview() {
  const s = dbState();
  const today = todayStr();
  const weekStart = startOfWeek(today, 1);
  const nextWeekStart = addDays(weekStart, 7);
  const nextWeekEnd = addDays(weekStart, 13);

  const doneThisWeek = s.tasks.filter((t) => t.completed_at_date && t.completed_at_date >= weekStart && t.completed_at_date <= today);
  const carried = s.tasks.filter((t) => !t.deleted && t.due_date && t.due_date >= weekStart && t.due_date <= today && t.status !== 'completed' && t.status !== 'cancelled');
  const nextWeek = s.tasks.filter((t) => t.due_date && t.due_date >= nextWeekStart && t.due_date <= nextWeekEnd && t.status !== 'completed');
  const projects = s.projects.filter((p) => p.status === 'active');
  const goals = s.goals.filter((g) => g.status === 'active');

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="section-title mb-1">Week of {fmtDate(weekStart)}</h2>
        <p className="text-sm muted">{doneThisWeek.length} completed · {carried.length} carried forward · {nextWeek.length} scheduled next week</p>
      </div>

      <ReviewSection title="Completed this week" count={doneThisWeek.length} empty="A quiet week.">
        {doneThisWeek.slice(0, 10).map((t) => <TaskRow key={t.id} task={t} onEdit={() => {}} />)}
      </ReviewSection>

      <ReviewSection title="Carried forward — reschedule" count={carried.length} empty="Nothing carried over.">
        {carried.slice(0, 10).map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <div className="flex-1"><TaskRow task={t} onEdit={() => {}} /></div>
            <button className="btn-secondary btn-sm shrink-0" onClick={() => void updateTask(t.id, { due_date: nextWeekStart } as any)}>
              → Next week
            </button>
          </div>
        ))}
      </ReviewSection>

      <ReviewSection title="Projects progressed" count={projects.length} empty="No active projects.">
        <div className="grid gap-2 sm:grid-cols-2">
          {projects.map((p) => {
            const tasks = s.tasks.filter((t) => t.project_id === p.id && !t.deleted);
            const done = tasks.filter((t) => t.status === 'completed').length;
            return (
              <div key={p.id} className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3.5 py-2.5 text-sm">
                <span className="font-semibold">{p.name}</span>
                <span className="float-right muted">{tasks.length ? Math.round((done / tasks.length) * 100) : 0}%</span>
              </div>
            );
          })}
        </div>
      </ReviewSection>

      <ReviewSection title="Goals progress" count={goals.length} empty="No active goals.">
        <div className="grid gap-2 sm:grid-cols-2">
          {goals.map((g) => {
            const ms = s.goal_milestones.filter((m) => m.goal_id === g.id);
            const pct = ms.length ? Math.round((ms.filter((m) => m.done).length / ms.length) * 100) : g.progress;
            return (
              <div key={g.id} className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3.5 py-2.5 text-sm">
                <span className="font-semibold">{g.title}</span>
                <span className="float-right muted">{pct}%</span>
              </div>
            );
          })}
        </div>
      </ReviewSection>

      <ReviewSection title="Next week's schedule" count={nextWeek.length} empty="Nothing scheduled for next week yet.">
        <ul className="divide-y divide-slate-900/5 dark:divide-white/10">
          {nextWeek.sort((a, b) => a.due_date!.localeCompare(b.due_date!)).map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm">
              <span className="truncate">{t.title}</span>
              <span className="chip shrink-0">{relativeDay(t.due_date)}</span>
            </li>
          ))}
        </ul>
      </ReviewSection>
    </div>
  );
}

function ReviewSection({ title, count, empty, children }: {
  title: string; count: number; empty: string; children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title">{title}</h2>
        {count > 0 && <span className="chip chip-brand">{count}</span>}
      </div>
      {count === 0 ? <p className="text-sm muted">{empty}</p> : <div className="space-y-2">{children}</div>}
    </section>
  );
}
