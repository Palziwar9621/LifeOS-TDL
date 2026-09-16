// LifeOS — web notifications + reminder scheduler
import { dbState, snoozeReminder, updateReminder, completeTask, updateTask, getSettings } from './db';
import { splitIso, todayStr, dateTimeFrom } from './dates';
import type { Reminder, Task } from './types';

type Timer = ReturnType<typeof setInterval>;

let timer: Timer | null = null;
const notified = new Set<string>();
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
  const check = () => {
    try {
      if (getSettings().notifications_enabled === false) return;
      const now = Date.now();
      const s = dbState();

      for (const r of s.reminders) {
        if (r.done || r.deleted) continue;
        const fireAt = r.snoozed_until ? new Date(r.snoozed_until).getTime() : new Date(r.due_at).getTime();
        const key = `rem:${r.id}:${r.snoozed_until ?? r.due_at}`;
        if (fireAt <= now && now - fireAt < 60000 * 60 * 12 && !notified.has(key)) {
          notified.add(key);
          show(
            r.important ? '⭐ ' + r.title : r.title,
            r.notes ?? 'Reminder',
            r.id + ':' + (r.snoozed_until ?? r.due_at),
            () => clickHandler?.(r),
          );
          void updateReminder(r.id, { fired_at: new Date().toISOString() } as any);
        }
      }

      const today = todayStr();
      for (const t of s.tasks) {
        if (t.deleted || t.archived || t.status === 'completed' || t.status === 'cancelled') continue;
        const fire = taskReminderFireTime(t);
        if (!fire) continue;
        if (t.reminder_minutes == null) continue;
        const fireMs = fire.getTime();
        const key = `task:${t.id}:${t.due_date}:${t.due_time}`;
        if (fireMs <= now && now - fireMs < 60000 * 60 * 12 && !notified.has(key)) {
          notified.add(key);
          show('Task due soon', t.title, t.id + ':' + t.due_date, () => taskClickHandler?.(t));
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
