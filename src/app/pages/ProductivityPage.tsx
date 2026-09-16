// LifeOS — Productivity: weekly routine tasks with daily check-offs + custom-day tasks.
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

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function ProductivityPage() {
  getDbVersion(); // re-render on any db change
  const s = dbState();
  const { confirm, confirmEl } = useConfirm();
  const today = todayStr();
  const [editing, setEditing] = useState<RoutineTask | 'new' | null>(null);
  const [viewDate, setViewDate] = useState(today);
  const [showAll, setShowAll] = useState(false);

  const viewingWeekday = parseDateStr(viewDate).getDay();
  const isToday = viewDate === today;

  const tasksForDay = (date: string): RoutineTask[] => {
    const wd = parseDateStr(date).getDay();
    return s.routine_tasks
      .filter((t) => !t.archived && (t.weekday === wd || t.extra_date === date))
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
          <p className="text-sm muted">Your daily routine. Tick what you did — see the chain grow.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" className="h-4 w-4" /> Add routine task
        </button>
      </div>

      {/* Week strip */}
      <div className="card p-3 mb-4">
        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((d) => {
            const wd = parseDateStr(d).getDay();
            const ts = tasksForDay(d);
            const done = ts.filter((t) => isDone(t.id, d)).length;
            const all = ts.length > 0 && done === ts.length;
            const active = d === viewDate;
            return (
              <button key={d} onClick={() => setViewDate(d)}
                className={`flex flex-col items-center rounded-xl py-2 transition ${active ? 'bg-brand-600 text-white shadow' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                aria-label={`${DAY_FULL[wd]} ${fmtDate(d)}`}>
                <span className={`text-[11px] font-semibold ${active ? 'text-white/80' : 'muted'}`}>{DAY_LABELS[wd]}</span>
                <span className={`text-sm font-bold ${active ? '' : ''}`}>{parseDateStr(d).getDate()}</span>
                <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${ts.length === 0 ? 'opacity-20 bg-slate-400' : all ? 'bg-emerald-500' : done > 0 ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600'}`}
                  title={ts.length ? `${done}/${ts.length} done` : 'no tasks'} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Day header + progress */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">
              {isToday ? 'Today' : DAY_FULL[viewingWeekday]}
              <span className="ml-2 text-sm font-normal muted">{fmtDate(viewDate, { weekday: undefined })}</span>
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
          hint="Add tasks you want to repeat every week on specific days — or one-off tasks for custom dates."
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
                    {t.weekday !== null ? `Every ${DAY_FULL[t.weekday]}` : `One-off · ${fmtDate(t.extra_date)}`}
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

      {/* Full week overview */}
      {s.routine_tasks.length > 0 && (
        <div className="card p-4 mt-4">
          <button className="flex items-center gap-2 text-sm font-semibold" onClick={() => setShowAll((v) => !v)}>
            <Icon name={showAll ? 'chevronD' : 'chevronR'} className="h-4 w-4" /> All routine tasks ({s.routine_tasks.filter(t => !t.archived).length})
          </button>
          {showAll && (
            <div className="mt-3 grid gap-1.5 text-sm">
              {DAY_FULL.map((day, wd) => {
                const list = s.routine_tasks.filter((t) => !t.archived && t.weekday === wd);
                if (list.length === 0) return null;
                return (
                  <div key={day} className="flex gap-2 items-start">
                    <span className="w-16 shrink-0 text-xs font-bold muted pt-0.5">{day}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((t) => (
                        <span key={t.id} className="chip cursor-pointer" style={{ borderColor: t.color }}
                          onClick={() => setEditing(t)} title="Click to edit">
                          {t.title}{t.time_of_day ? ` · ${t.time_of_day.slice(0, 5)}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              {(() => {
                const oneoffs = s.routine_tasks.filter((t) => !t.archived && t.weekday === null);
                if (oneoffs.length === 0) return null;
                return (
                  <div className="flex gap-2 items-start">
                    <span className="w-16 shrink-0 text-xs font-bold muted pt-0.5">Custom</span>
                    <div className="flex flex-wrap gap-1.5">
                      {oneoffs.map((t) => (
                        <span key={t.id} className="chip cursor-pointer" style={{ borderColor: t.color }} onClick={() => setEditing(t)}>
                          {t.title} · {fmtDate(t.extra_date)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {editing && (
        <RoutineEditor
          task={editing === 'new' ? null : editing}
          defaultDate={viewDate}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmEl}
    </div>
  );
}

// ------------------------------------------------------------------
function RoutineEditor({ task, defaultDate, onClose }: { task: RoutineTask | null; defaultDate: string; onClose: () => void }) {
  const { toast } = useAppToast();
  const [title, setTitle] = useState(task?.title ?? '');
  const [repeat, setRepeat] = useState<'weekly' | 'custom'>(task ? (task.weekday !== null ? 'weekly' : 'custom') : 'weekly');
  const [weekday, setWeekday] = useState(task?.weekday ?? parseDateStr(defaultDate).getDay());
  const [extraDate, setExtraDate] = useState(task?.extra_date ?? defaultDate);
  const [timeOfDay, setTimeOfDay] = useState(task?.time_of_day ? task.time_of_day.slice(0, 5) : '');
  const [color, setColor] = useState(task?.color ?? COLORS[0]);
  const [alarmSound, setAlarmSound] = useState<string | null>(task?.alarm_sound ?? null);

  const save = async () => {
    if (!title.trim()) { toast('Give the task a name', 'error'); return; }
    const payload = {
      title: title.trim(),
      weekday: repeat === 'weekly' ? weekday : null,
      extra_date: repeat === 'custom' ? extraDate : null,
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
            <button className={`btn-sm btn ${repeat === 'weekly' ? 'btn-primary' : 'btn-secondary'} py-2.5`} onClick={() => setRepeat('weekly')}>
              Every week
            </button>
            <button className={`btn-sm btn ${repeat === 'custom' ? 'btn-primary' : 'btn-secondary'} py-2.5`} onClick={() => setRepeat('custom')}>
              Custom day
            </button>
          </div>
        </div>
        {repeat === 'weekly' ? (
          <div>
            <label className="label">Day of week</label>
            <div className="grid grid-cols-7 gap-1">
              {DAY_LABELS.map((d, i) => (
                <button key={d} onClick={() => setWeekday(i)}
                  className={`rounded-lg py-2 text-xs font-bold transition ${weekday === i ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                  aria-pressed={weekday === i}>
                  {d}
                </button>
              ))}
            </div>
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
function useAppToast() { return useApp(); }
