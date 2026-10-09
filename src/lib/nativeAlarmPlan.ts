import type { Reminder, Task, RoutineTask } from './types';

export interface NativeAlarm {
  key: string;
  at: number;
  title: string;
  body: string;
  /** Wall-clock events follow the device timezone; reminders remain instants. */
  localAt?: string;
  leadMinutes?: number;
}

type AlarmState = {
  reminders: Reminder[];
  tasks: Task[];
  routine_tasks: RoutineTask[];
  routine_completions: { task_id: string; done_date: string }[];
};

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A bounded offline snapshot, refreshed while the app is running. */
export function planNativeAlarms(s: AlarmState, now: number, dismissed: (key: string) => boolean, includeOverdue = false): NativeAlarm[] {
  const out: NativeAlarm[] = [];
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 7);
  const add = (a: NativeAlarm, bounded = false) => {
    if (Number.isFinite(a.at) && (includeOverdue || a.at > now) && (!bounded || a.at <= horizon.getTime()) && !dismissed(a.key)) out.push(a);
  };
  for (const r of s.reminders) {
    if (r.done || r.deleted) continue;
    const due = r.snoozed_until ?? r.due_at;
    add({ key: `rem:${r.id}:${due}`, at: new Date(due).getTime(), title: '⏰ ' + (r.important ? '⭐ ' : '') + r.title, body: r.notes ?? 'Reminder' });
  }
  for (const t of s.tasks) {
    if (t.deleted || t.archived || t.status === 'completed' || t.status === 'cancelled' || t.remind_me === false || !t.due_date) continue;
    const localAt = t.due_date + 'T' + (t.due_time ?? '09:00');
    const leadMinutes = t.reminder_minutes ?? 0;
    add({ key: `task:${t.id}:${t.due_date}:${t.due_time}`, at: new Date(localAt).getTime() - leadMinutes * 60000, localAt, leadMinutes, title: '⏰ Task due soon', body: t.title });
  }
  for (const rt of s.routine_tasks) {
    if (rt.archived || !rt.time_of_day) continue;
    // Calendar arithmetic, not UTC serialization or fixed 24h increments:
    // both change the date in positive-offset zones / across DST.
    for (let i = includeOverdue ? -1 : 0; i <= 7; i++) {
      const day = new Date(now);
      day.setHours(12, 0, 0, 0);
      day.setDate(day.getDate() + i);
      const date = localDate(day);
      const matches = (rt.days?.length ? rt.days.includes(day.getDay()) : rt.weekday === day.getDay()) || rt.extra_date === date;
      if (!matches || s.routine_completions.some(c => c.task_id === rt.id && c.done_date === date)) continue;
      const localAt = date + 'T' + rt.time_of_day;
      add({ key: `routine:${rt.id}:${date}`, at: new Date(localAt).getTime(), localAt, title: '⏰ Routine time', body: rt.title }, true);
    }
  }
  return out;
}
