// LifeOS — native alarm bridge.
//
// The in-app scheduler only rings while the app is open, and web push only
// works in real browsers. This bridge closes that gap for the installed
// apps: it computes future reminders/tasks and 7 days of routine alarms (same rules as
// notifications.ts) and hands them to the native layer:
//
//   Android shell → AlarmManager exact alarms via a JS interface
//   Electron      → main-process timers via contextBridge IPC
//
// The native layer shows a full-alarm notification with sound; tapping it
// opens the app. Re-synced whenever data changes, on app focus, and after
// boot (Android re-schedules from a persisted snapshot).

import { dbState, getSettings, subscribeDb } from './db';
import { isKeyDismissed, dismissKey, syncDismissals } from './dismissals';
import { planNativeAlarms, type NativeAlarm } from './nativeAlarmPlan';
export type { NativeAlarm } from './nativeAlarmPlan';

function alarmSound(): string {
  return (getSettings().alarm_sound as string) || 'chime';
}

export function computeUpcomingAlarms(): NativeAlarm[] {
  return planNativeAlarms(dbState(), Date.now(), isKeyDismissed);
}

// ------------------------------------------------------------------
// Native bridges
// ------------------------------------------------------------------

/** Detect the native layer. Android injects scheduleAlarms directly on window.LifeOSNative (addJavascriptInterface); Electron nests it under LifeOSNative.alarms (contextBridge). */
function bridgeFn(): ((payload: string) => unknown) | null {
  if (typeof window === 'undefined') return null;
  const n = (window as any).LifeOSNative;
  if (!n) return null;
  const fn = n.alarms?.scheduleAlarms ?? n.scheduleAlarms;
  if (typeof fn !== 'function') return null;
  return fn.bind(n.alarms ?? n);
}

/** Last result reported by the native layer ({ok, scheduled, next} or {ok:false, error}). */
export let lastSyncStatus: string | null = null;
export function nativeSyncStatus(): string | null { return lastSyncStatus; }

export function nativeAlarmsActive(): 'android' | 'electron' | null {
  if (!bridgeFn()) return null;
  const platform = (window as any).LifeOSNative?.platform;
  return platform === 'electron' ? 'electron' : 'android';
}

let lastPayload = '';
let syncInFlight = false;
let syncAgain = false;

/** Push current upcoming alarms to the native layer (no-op in browsers). */
export async function syncNativeAlarms(): Promise<void> {
  const n = (typeof window !== 'undefined') ? (window as any).LifeOSNative : null;
  const fn = bridgeFn();
  if (!fn) { lastSyncStatus = null; return; }
  // Do not replace the persisted offline schedule with an empty startup store.
  if (!dbState().user_settings) return;
  if (syncInFlight) { syncAgain = true; return; }

  // Adopt alarms the user turned off natively on this device (Android
  // notification action) into the shared record — silences every device.
  try {
    const keys: string = n?.dismissedKeys?.() ?? '';
    for (const k of keys.split(',')) if (k && !isKeyDismissed(k)) dismissKey(k);
  } catch { /* bridge without the new method — fine */ }

  const settings = getSettings();
  const mode = settings.notifications_enabled === false || settings.alert_mode === 'off'
    ? 'off' : settings.alert_mode === 'alarm' ? 'alarm' : 'notify';
  const alarms = mode === 'off' ? [] : computeUpcomingAlarms();
  // Overdue active occurrences retain native snoozes. Deleted, edited,
  // completed or dismissed occurrences cancel them on the same update.
  const activeKeys = mode === 'off' ? [] : planNativeAlarms(dbState(), Date.now(), isKeyDismissed, true).map(a => a.key);
  const payload = JSON.stringify({ sound: alarmSound(), mode, alarms, activeKeys });
  if (payload === lastPayload) return;
  syncInFlight = true;
  try {
    const res = await fn(payload);
    lastSyncStatus = typeof res === 'string' ? res : JSON.stringify(res) ?? null;
    const status = typeof res === 'string' ? JSON.parse(res) : res;
    // A rejected exact permission / IPC failure must remain retryable.
    if ((status as any)?.ok === true) lastPayload = payload;
  } catch (e) {
    lastSyncStatus = 'error: ' + String(e);
  } finally {
    syncInFlight = false;
    if (syncAgain) { syncAgain = false; void syncNativeAlarms(); }
  }
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

/** Called once at boot; re-syncs periodically and on data changes. */
export function startNativeAlarmSync(): void {
  if (syncTimer) return;
  // Load the shared dismissal record first so alarms stopped on another
  // device are filtered out of the very first push to the native layer.
  void syncNativeAlarms();
  void syncDismissals().then(syncNativeAlarms).catch(() => {});
  subscribeDb(() => { void syncNativeAlarms(); });
  // Data changes bump the store version; re-check every minute regardless.
  syncTimer = setInterval(() => { void syncDismissals().then(syncNativeAlarms); }, 60000);
  window.addEventListener('focus', () => { lastPayload = ''; void syncNativeAlarms(); });
}
