// LifeOS — native alarm bridge.
//
// The in-app scheduler only rings while the app is open, and web push only
// works in real browsers. This bridge closes that gap for the installed
// apps: it computes the next 24h of due alarms (same rules as
// notifications.ts) and hands them to the native layer:
//
//   Android shell → AlarmManager exact alarms via a JS interface
//   Electron      → main-process timers via contextBridge IPC
//
// The native layer shows a full-alarm notification with sound; tapping it
// opens the app. Re-synced whenever data changes, on app focus, and after
// boot (Android re-schedules from a persisted snapshot).

import { dbState, getSettings } from './db';
import { todayStr, parseDateStr } from './dates';
import type { Reminder, Task, RoutineTask } from './types';

export interface NativeAlarm {
  /** Unique, stable key — dedupe + cancel on reschedule. */
  key: string;
  /** Epoch ms when the alarm should ring. */
  at: number;
  title: string;
  body: string;
}

function alarmSound(): string {
  return ((getSettings().data as any)?.alarm_sound as string) || 'chime';
}

export function computeUpcomingAlarms(): NativeAlarm[] {
  const out: NativeAlarm[] = [];
  const now = Date.now();
  const horizon = now + 24 * 60 * 60 * 1000;
  const s = dbState();
  const defaultSound = alarmSound();

  const add = (key: string, at: number, title: string, body: string) => {
    if (at > now && at <= horizon) out.push({ key, at, title, body: body + (defaultSound !== 'none' ? '' : ' (silent)') });
  };

  // Reminders
  for (const r of s.reminders as Reminder[]) {
    if (r.done || r.deleted) continue;
    const fireAt = r.snoozed_until ? new Date(r.snoozed_until).getTime() : new Date(r.due_at).getTime();
    add(`rem:${r.id}:${r.snoozed_until ?? r.due_at}`, fireAt, '⏰ ' + (r.important ? '⭐ ' : '') + r.title, r.notes ?? 'Reminder');
  }

  // Tasks with alert lead time
  for (const t of s.tasks as Task[]) {
    if (t.deleted || t.archived || t.status === 'completed' || t.status === 'cancelled') continue;
    if (t.reminder_minutes == null || !t.due_date) continue;
    const due = new Date(t.due_date + 'T' + (t.due_time ?? '09:00')).getTime();
    add(`task:${t.id}:${t.due_date}:${t.due_time}`, due - (t.reminder_minutes ?? 0) * 60000, '⏰ Task due soon', t.title);
  }

  // Routine tasks with a time of day — today + tomorrow (multi-day aware).
  const today = todayStr();
  const tomorrow = new Date(parseDateStr(today).getTime() + 86400000);
  const t2 = tomorrow.toISOString().slice(0, 10);
  const dowToday = parseDateStr(today).getDay();
  const dowTomorrow = (dowToday + 1) % 7;
  const routineOn = (rt: RoutineTask, date: string, dow: number) => {
    if (rt.archived || !rt.time_of_day) return false;
    if (rt.days && rt.days.length) return rt.days.includes(dow);
    if (rt.weekday != null) return rt.weekday === dow;
    return rt.extra_date === date;
  };
  const doneOn = (rt: RoutineTask, date: string) =>
    s.routine_completions.some((c) => c.task_id === rt.id && c.done_date === date);
  for (const rt of s.routine_tasks as RoutineTask[]) {
    for (const [date, dow] of [[today, dowToday], [t2, dowTomorrow]] as const) {
      if (!routineOn(rt, date, dow) || doneOn(rt, date)) continue;
      const at = new Date(date + 'T' + rt.time_of_day).getTime();
      add(`routine:${rt.id}:${date}`, at, '⏰ Routine time', rt.title);
    }
  }

  return out;
}

// ------------------------------------------------------------------
// Native bridges
// ------------------------------------------------------------------

/** Detect the native layer. Android injects scheduleAlarms directly on window.LifeOSNative (addJavascriptInterface); Electron nests it under LifeOSNative.alarms (contextBridge). */
function bridgeFn(): ((payload: string) => void) | null {
  if (typeof window === 'undefined') return null;
  const n = (window as any).LifeOSNative;
  if (!n) return null;
  const fn = n.alarms?.scheduleAlarms ?? n.scheduleAlarms;
  if (typeof fn !== 'function') return null;
  return fn.bind(n.alarms ?? n);
}

export function nativeAlarmsActive(): 'android' | 'electron' | null {
  if (!bridgeFn()) return null;
  const platform = (window as any).LifeOSNative?.platform;
  return platform === 'electron' ? 'electron' : 'android';
}

let lastPayload = '';

/** Push current upcoming alarms to the native layer (no-op in browsers). */
export function syncNativeAlarms(): void {
  const fn = bridgeFn();
  if (!fn) return;
  const alarms = computeUpcomingAlarms();
  const payload = JSON.stringify({ sound: alarmSound(), alarms });
  if (payload === lastPayload) return;
  lastPayload = payload;
  try {
    fn(payload);
  } catch { /* native layer broken — never crash the web app */ }
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

/** Called once at boot; re-syncs periodically and on data changes. */
export function startNativeAlarmSync(): void {
  if (syncTimer) return;
  // Initial kick after the store has loaded.
  setTimeout(syncNativeAlarms, 5000);
  // Data changes bump the store version; re-check every minute regardless.
  syncTimer = setInterval(syncNativeAlarms, 60000);
  window.addEventListener('focus', syncNativeAlarms);
}
