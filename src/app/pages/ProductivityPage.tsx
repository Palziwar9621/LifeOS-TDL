// LifeOS — Productivity: routine tasks with daily check-offs.
// Two views: "Day" (check off today / any day) and "Week" (planner grid showing
// every routine across Mon–Sun, like the weekly planner).
import React, { useMemo, useState } from 'react';
import { Icon, Modal, EmptyState, useConfirm } from '../../ui/components';
import {
  dbState, createRoutineTask, updateRoutineTask, deleteRoutineTask,
  toggleRoutineCompletion, getDbVersion,
} from '../../lib/db';
import { todayStr, toLocalDateStr, parseDateStr, addDays, startOfWeek, fmtDate } from '../../lib/dates';
import type { RoutineTask } from '../../lib/types';
import { AlarmSoundPicker } from '../AlarmSoundPicker';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

/** Weekdays a routine repeats on (normalizing legacy single weekday). */
function taskDays(t: RoutineTask): number[] {
  if (t.days && t.days.length) return [...t.days].sort();
  if (t.weekday !== null) return [t.weekday];
  return [];
}

export function ProductivityPage() {
  getDbVersion(); // re-render on any db change
  const s = dbState();
  const { confirm, confirmEl } = useConfirm();
  const today = todayStr();
  const [editing, setEditing] = useState<RoutineTask | 'new' | null>(null);
  const [viewDate, setViewDate] = useState(today);
  const [view, setView] = useState<'day' | 'week'>('day');

  const isToday = viewDate === today;

  const tasksForDay = (date: string): RoutineTask[] => {
    const wd = parseDateStr(date).getDay();
    return s.routine_tasks
      .filter((t) => !t.archived && (taskDays(t).includes(wd) || t.extra_date === date))
      .sort((a, b) => (a.time_of_day ?? '99') < (b.time_of_day ?? '99') ? -1 : 1);
  };

  const isDone = (taskId: string, date: string) =>
    s.routine_completions.some((c) => c.task_id === taskId && c.done_date === date);

  const dayTasks = tasksForDay(viewDate);
  const doneCount = dayTasks.filter((t) => isDone(t.id, viewDate)).length;
  const pct = dayTasks.length ? Math.round((doneCount / dayTasks.length) * 100) : 0;

  // week strip (Mon..Sun of the viewed date's week)
  const weekStart = startOfWeek(viewDate, 1);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // streak: consecutive days (ending today) with at least one task and all done
  const streak = useMemo(() => {
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const d = addDays(today, -i);
      const ts = tasksForDay(d);
      if (ts.length === 0) continue;
      const all = ts.every((t) => isDone(t.id, d));
      if (all) n++;
      else break;
    }
    return n;
  }, [s.routine_completions, s.routine_tasks, today]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Productivity</h1>
          <p className="text-sm muted">Your daily routine — tick what you did, see the chain grow.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-xl ring-1 ring-slate-900/10 dark:ring-white/10">
            {(['day', 'week'] as const).map((v) => (
              <button key={v} className={`px-3.5 py-2 text-sm font-semibold capitalize ${view === v ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
                onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      {/* Week strip — always visible for quick day jumping */}
      <div className="card p-3 mb-4">
        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((d) => {
            const wd = parseDateStr(d).getDay();
            const ts = tasksForDay(d);
            const done = ts.filter((t) => isDone(t.id, d)).length;
            const all = ts.length > 0 && done === ts.length;
            const active = d === viewDate && view === 'day';
            return (
              <button key={d} onClick={() => { setViewDate(d); setView('day'); }}
                className={`flex flex-col items-center rounded-xl py-2 transition ${active ? 'bg-brand-600 text-white shadow' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                aria-label={`${DAY_FULL[wd]} ${fmtDate(d)}`}>
                <span className={`text-[11px] font-semibold ${active ? 'text-white/80' : 'muted'}`}>{DAY_LABELS[wd]}</span>
                <span className="text-sm font-bold">{parseDateStr(d).getDate()}</span>
                <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${ts.length === 0 ? 'opacity-20 bg-slate-400' : all ? 'bg-emerald-500' : done > 0 ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600'}`}
                  title={ts.length ? `${done}/${ts.length} done` : 'no tasks'} />
              </button>
            );
          })}
        </div>
      </div>

      {view === 'day' ? (
        <>
          {/* Day header + progress */}
          <div className="card p-4 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">
                  {isToday ? 'Today' : DAY_FULL[parseDateStr(viewDate).getDay()]}
                  <span className="ml-2 text-sm font-normal muted">{fmtDate(viewDate)}</span>
                </h2>
                <p className="text-xs muted">
                  {dayTasks.length === 0 ? 'No routine tasks for this day' : `${doneCount} of ${dayTasks.length} done`}
                  {streak > 1 && <span className="ml-2" title="All-completed day streak">🔥 {streak}-day streak</span>}
                </p>
              </div>
              {dayTasks.length > 0 && (
                <div className="text-right">
                  <p className="text-2xl font-extrabold text-brand-600 dark:text-brand-300">{pct}%</p>
                </div>
              )}
            </div>
            {dayTasks.length > 0 && (
              <div className="mt-3 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
            {!isToday && (
              <button className="btn-ghost btn-sm mt-2" onClick={() => setViewDate(today)}>← Back to today</button>
            )}
          </div>

          {/* Task list */}
          {dayTasks.length === 0 ? (
            <EmptyState icon="check" title="Nothing scheduled"
              hint="Add a routine that repeats on specific weekdays — like gym on Mon, Tue and Fri."
              action={<button className="btn-primary mt-2" onClick={() => setEditing('new')}>Add your first routine task</button>} />
          ) : (
            <div className="space-y-2">
              {dayTasks.map((t) => {
                const done = isDone(t.id, viewDate);
                return (
                  <div key={t.id} className={`card p-3 flex items-center gap-3 transition ${done ? 'opacity-70' : ''}`}>
                    <button
                      className={`h-7 w-7 shrink-0 rounded-full border-2 flex items-center justify-center transition ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-emerald-400'}`}
                      onClick={() => void toggleRoutineCompletion(t.id, viewDate)}
                      aria-label={done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
                      aria-pressed={done}
                    >
                      {done && <Icon name="check" className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold truncate ${done ? 'line-through' : ''}`}>{t.title}</p>
                      <div className="flex items-center gap-2 text-xs muted">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                        <RoutineRepeatLabel task={t} />
                        {t.time_of_day && <span>· {t.time_of_day.slice(0, 5)}</span>}
                      </div>
                    </div>
                    <button className="btn-ghost btn-sm shrink-0" aria-label={`Edit ${t.title}`} onClick={() => setEditing(t)}>
                      <Icon name="edit" className="h-4 w-4" />
                    </button>
                    <button className="btn-ghost btn-sm text-rose-500 shrink-0" aria-label={`Delete ${t.title}`}
                      onClick={() => confirm('Delete routine task?', `"${t.title}" and its check-off history will be removed.`, () => void deleteRoutineTask(t.id))}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ---------------- WEEK GRID (planner-style) ---------------- */
        <WeekGrid
          tasks={s.routine_tasks.filter((t) => !t.archived)}
          weekDays={weekDays}
          isDone={isDone}
          onToggle={(id, d) => void toggleRoutineCompletion(id, d)}
          onEdit={(t) => setEditing(t)}
          onAddDay={(wd) => { setEditing('new'); newTaskDay = wd; }}
          today={today}
          viewDate={viewDate}
          onPickDay={(d) => { setViewDate(d); setView('day'); }}
        />
      )}

      {editing && (
        <RoutineEditor
          task={editing === 'new' ? null : editing}
          defaultDate={viewDate}
          onClose={() => { setEditing(null); newTaskDay = null; }}
        />
      )}
      {confirmEl}
    </div>
  );
}

// module-level "add on this day" handoff (simple, avoids extra state plumbing)
let newTaskDay: number | null = null;

function RoutineRepeatLabel({ task }: { task: RoutineTask }) {
  const days = taskDays(task);
  if (task.extra_date && days.length === 0) return <span>One-off · {fmtDate(task.extra_date)}</span>;
  if (days.length === 7) return <span>Every day</span>;
  if (days.length === 0) return <span>Custom</span>;
  if (days.length === 1) return <span>Every {DAY_FULL[days[0]]}</span>;
  return <span>Every {days.map((d) => DAY_LABELS[d]).join(', ')}</span>;
}

// ------------------------------------------------------------------
function WeekGrid({ tasks, weekDays, isDone, onToggle, onEdit, onAddDay, today, viewDate, onPickDay }: {
  tasks: RoutineTask[];
  weekDays: string[];
  isDone: (id: string, d: string) => boolean;
  onToggle: (id: string, d: string) => void;
  onEdit: (t: RoutineTask) => void;
  onAddDay: (wd: number) => void;
  today: string;
  viewDate: string;
  onPickDay: (d: string) => void;
}) {
  const forDay = (date: string) => {
    const wd = parseDateStr(date).getDay();
    return tasks
      .filter((t) => taskDays(t).includes(wd) || t.extra_date === date)
      .sort((a, b) => (a.time_of_day ?? '99') < (b.time_of_day ?? '99') ? -1 : 1);
  };

  return (
    <div className="space-y-2">
      {weekDays.map((d) => {
        const wd = parseDateStr(d).getDay();
        const list = forDay(d);
        const done = list.filter((t) => isDone(t.id, d)).length;
        const isTodayCol = d === today;
        return (
          <div key={d} className={`card p-3 ${isTodayCol ? 'ring-2 ring-brand-500' : ''}`}>
            <div className="mb-2 flex items-center justify-between">
              <button className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide" onClick={() => onPickDay(d)}>
                {DAY_LABELS[wd]} {parseDateStr(d).getDate()}
                {isTodayCol && <span className="chip chip-brand !py-0 text-[10px]">today</span>}
                {list.length > 0 && <span className="text-[11px] font-normal muted">{done}/{list.length}</span>}
              </button>
              <button className="btn-ghost btn-sm !px-1.5" aria-label={`Add routine on ${DAY_FULL[wd]}`} onClick={() => onAddDay(wd)}>
                <Icon name="plus" className="h-3.5 w-3.5" />
              </button>
            </div>
            {list.length === 0 ? (
              <p className="py-1 text-xs muted">—</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {list.map((t) => {
                  const done = isDone(t.id, d);
                  return (
                    <span key={t.id} role="checkbox" aria-checked={done} tabIndex={0}
                      className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 ${done ? 'opacity-50 line-through' : ''}`}
                      style={{ background: t.color }}
                      title={`${t.title}${t.time_of_day ? ' · ' + t.time_of_day.slice(0, 5) : ''} — click to ${done ? 'untick' : 'tick'}`}
                      onClick={() => onToggle(t.id, d)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(t.id, d); } }}>
                      <span className="truncate">{t.title}</span>
                      {t.time_of_day && <span className="text-white/80">{t.time_of_day.slice(0, 5)}</span>}
                      <button className="ml-0.5 opacity-70 hover:opacity-100" aria-label={`Edit ${t.title}`}
                        onClick={(e) => { e.stopPropagation(); onEdit(t); }}>
                        <Icon name="edit" className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
function RoutineEditor({ task, defaultDate, onClose }: { task: RoutineTask | null; defaultDate: string; onClose: () => void }) {
  const { toast } = useAppToast();
  const [title, setTitle] = useState(task?.title ?? '');
  // modes: weekly = pick one or more weekdays; once = a single specific date
  const initialDays = task ? taskDays(task) : newTaskDay !== null ? [newTaskDay] : [parseDateStr(defaultDate).getDay()];
  const [mode, setMode] = useState<'weekly' | 'once'>(
    task ? (task.extra_date && taskDays(task).length === 0 ? 'once' : 'weekly') : 'weekly'
  );
  const [days, setDays] = useState<number[]>(initialDays);
  const [extraDate, setExtraDate] = useState(task?.extra_date ?? defaultDate);
  const [timeOfDay, setTimeOfDay] = useState(task?.time_of_day ? task.time_of_day.slice(0, 5) : '');
  const [color, setColor] = useState(task?.color ?? COLORS[0]);
  const [alarmSound, setAlarmSound] = useState<string | null>(task?.alarm_sound ?? null);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const save = async () => {
    if (!title.trim()) { toast('Give the task a name', 'error'); return; }
    if (mode === 'weekly' && days.length === 0) { toast('Pick at least one day', 'error'); return; }
    const payload = {
      title: title.trim(),
      weekday: mode === 'weekly' && days.length === 1 ? days[0] : null,
      days: mode === 'weekly' ? (days.length ? days : null) : null,
      extra_date: mode === 'once' ? extraDate : null,
      time_of_day: timeOfDay ? `${timeOfDay}:00` : null,
      color,
      alarm_sound: alarmSound,
    };
    if (task) await updateRoutineTask(task.id, payload);
    else await createRoutineTask(payload);
    toast(task ? 'Routine updated' : 'Routine task added', 'success');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={task ? 'Edit routine task' : 'New routine task'}>
      <div className="space-y-3">
        <div>
          <label className="label">Task</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Morning workout" />
        </div>
        <div>
          <label className="label">Repeats</label>
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn-sm btn ${mode === 'weekly' ? 'btn-primary' : 'btn-secondary'} py-2.5`} onClick={() => setMode('weekly')}>
              Every week
            </button>
            <button className={`btn-sm btn ${mode === 'once' ? 'btn-primary' : 'btn-secondary'} py-2.5`} onClick={() => setMode('once')}>
              One specific day
            </button>
          </div>
        </div>
        {mode === 'weekly' ? (
          <div>
            <label className="label">Days of week <span className="muted font-normal">(pick any — e.g. Mon + Tue + Wed)</span></label>
            <div className="grid grid-cols-7 gap-1">
              {DAY_LABELS.map((d, i) => (
                <button key={d} onClick={() => toggleDay(i)}
                  className={`rounded-lg py-2 text-xs font-bold transition ${days.includes(i) ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                  aria-pressed={days.includes(i)}>
                  {d}
                </button>
              ))}
            </div>
            {days.length > 1 && (
              <p className="mt-1.5 text-xs muted">Repeats on {days.map((d) => DAY_FULL[d]).join(', ')}.</p>
            )}
          </div>
        ) : (
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={extraDate} onChange={(e) => setExtraDate(e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Time <span className="muted font-normal">(optional)</span></label>
            <input type="time" className="input" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
          </div>
          <div>
            <label className="label">Color</label>
            <div className="flex gap-1.5 pt-1.5">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition ${color === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900' : ''}`}
                  style={{ background: c }} aria-label={`Color ${c}`} />
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="label">Alarm sound <span className="muted font-normal">(rings at the task time — click to hear)</span></label>
          <AlarmSoundPicker value={alarmSound} onChange={setAlarmSound} allowInherit />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-900/5 dark:border-white/10 pt-4">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()}>{task ? 'Save' : 'Add task'}</button>
        </div>
      </div>
    </Modal>
  );
}

// tiny helper to avoid importing the whole store context tree
import { useApp } from '../store';
const useAppToast = () => useApp();
