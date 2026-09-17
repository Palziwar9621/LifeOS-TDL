// LifeOS — web notifications + alarm scheduler
import { dbState, snoozeReminder, updateReminder, completeTask, updateTask, getSettings } from './db';
import { splitIso, todayStr, dateTimeFrom, parseDateStr } from './dates';
import { startAlarm, wasDismissed, isKeyDismissed } from './alarm';
import { syncDismissals } from './dismissals';
import { deliverAlert } from './alerts';
import type { Reminder, Task, RoutineTask } from './types';

type Timer = ReturnType<typeof setInterval>;

let timer: Timer | null = null;
const notified = new Set<string>();
let lastDateKey = '';
let clickHandler: ((r: Reminder | null) => void) | null = null;
let taskClickHandler: ((t: Task) => void) | null = null;

export function setReminderClickHandler(fn: (r: Reminder | null) => void) { clickHandler = fn; }
export function setTaskClickHandler(fn: (t: Task) => void) { taskClickHandler = fn; }

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function show(title: string, body: string, tag: string, onClick?: () => void): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      tag: `lifeos-${tag}`,
      icon: '/icons/icon-192.png',
    });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      onClick?.();
      n.close();
    };
  } catch {
    /* Notification constructor can throw in some contexts; never crash */
  }
}

function taskReminderFireTime(t: Task): Date | null {
  if (!t.due_date) return null;
  const base = dateTimeFrom(t.due_date, t.due_time ?? '09:00');
  const lead = t.reminder_minutes ?? 0;
  return new Date(base.getTime() - lead * 60000);
}

/** Check every 30s for reminders/tasks that should fire now. */
export function startReminderScheduler() {
  if (timer) return;
  // Re-sync the shared dismissal record so alarms stopped on another device
  // stay silent here too (throttled internally to every 5 min).
  void syncDismissals();
  const check = () => {
    try {
      if (getSettings().notifications_enabled === false) return;
      const now = Date.now();
      const today = todayStr();
      void syncDismissals(); // throttled; keeps cross-device silencing fresh
      const s = dbState();
      // Wait until settings have actually loaded (local cache or network).
      // Cold start + empty cache: alert_mode would read as the 'notify'
      // default, the alarm overlay would never show, and the key would be
      // consumed as "already notified" — silently dead until the next day.
      if (!s.user_settings) return;
      const defaultSound = (getSettings().data as any)?.alarm_sound as string | undefined;

      for (const r of s.reminders) {
        if (r.done || r.deleted) continue;
        const fireAt = r.snoozed_until ? new Date(r.snoozed_until).getTime() : new Date(r.due_at).getTime();
        const key = `rem:${r.id}:${r.snoozed_until ?? r.due_at}`;
        if (fireAt <= now && now - fireAt < 60000 * 60 * 12 && !notified.has(key) && !isKeyDismissed(key)) {
          notified.add(key);
          deliverAlert(
            key,
            '⏰ ' + (r.important ? '⭐ ' + r.title : r.title),
            r.notes ?? 'Reminder — tap to open LifeOS',
            () => { if (!wasDismissed(key)) startAlarm(key, defaultSound as any, { title: r.title, body: r.notes ?? 'Reminder' }); },
          );
          void updateReminder(r.id, { fired_at: new Date().toISOString() } as any);
        }
      }

      for (const t of s.tasks) {
        if (t.deleted || t.archived || t.status === 'completed' || t.status === 'cancelled') continue;
        const fire = taskReminderFireTime(t);
        if (!fire) continue;
        if (t.reminder_minutes == null) continue;
        const fireMs = fire.getTime();
        const key = `task:${t.id}:${t.due_date}:${t.due_time}`;
        if (fireMs <= now && now - fireMs < 60000 * 60 * 12 && !notified.has(key) && !isKeyDismissed(key)) {
          notified.add(key);
          deliverAlert(key, '⏰ Task due soon', t.title, () => {
            if (!wasDismissed(key)) startAlarm(key, defaultSound as any, { title: t.title, body: 'Task due soon' });
          });
        }
      }

      // Routine tasks with a time_of_day — alarm for today's unticked items.
      for (const rt of s.routine_tasks) {
        if (rt.archived || !rt.time_of_day) continue;
        const matches = rt.weekday === parseDateStr(today).getDay() || rt.extra_date === today;
        if (!matches) continue;
        const done = s.routine_completions.some((c) => c.task_id === rt.id && c.done_date === today);
        if (done) continue;
        const [h, m] = rt.time_of_day.split(':').map(Number);
        const fireMs = parseDateStr(today).getTime() + ((h * 60 + (m ?? 0)) * 60000 - new Date().getTimezoneOffset() * -60000);
        const fireAt = new Date(today + 'T' + rt.time_of_day).getTime();
        const key = `routine:${rt.id}:${today}`;
        if (fireAt <= now && now - fireAt < 60000 * 60 * 2 && !notified.has(key) && !isKeyDismissed(key)) {
          notified.add(key);
          deliverAlert(key, '⏰ Routine time', rt.title, () => {
            if (!wasDismissed(key)) startAlarm(key, defaultSound as any, { title: rt.title, body: 'Routine time' });
          });
        }
        void fireMs;
      }

      // Remember-item anniversaries (birthdays, monthly dates…).
      for (const item of s.remember_items) {
        if (item.deleted || !item.reminder_freq || !item.reminder_day) continue;
        const isAnniv = item.reminder_freq === 'yearly'
          ? parseInt(item.reminder_day.slice(5, 7), 10) === parseInt(today.slice(5, 7), 10) && parseInt(item.reminder_day.slice(8, 10), 10) === parseInt(today.slice(8, 10), 10)
          : parseInt(item.reminder_day.slice(8, 10), 10) === parseInt(today.slice(8, 10), 10);
        if (!isAnniv) continue;
        const key = `anniv:${item.id}:${today}`;
        if (!notified.has(key)) {
          notified.add(key);
          show('🎂 ' + item.title, item.reminder_note || 'Remember this date!', item.id + ':' + today);
          if (!wasDismissed(key)) startAlarm(key, defaultSound as any);
        }
      }
    } catch {
      /* never crash the scheduler */
    }
  };
  timer = setInterval(check, 30000);
  setTimeout(check, 3000);
}

export function stopReminderScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function clearNotifiedCache() {
  notified.clear();
}
