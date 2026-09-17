// LifeOS — reliable notification for routine/task times.
//
// The in-app schedulers (notifications.ts) already detect when a routine or
// task alert is due. This module delivers the actual notification through
// whatever channel the current environment supports:
//
//   Android shell (WebView)  → native system notification via the bridge
//                              (WebView has NO web Notification API)
//   Browser                  → web Notification API
//   Electron                 → web Notification API (renderer has it)
//
// The alert mode setting lives in user_settings.alert_mode:
//   'notify' — silent notification only (no alarm sound)   [DEFAULT]
//   'alarm'  — notification + full ringing alarm
//   'off'    — nothing

import { getSettings, updateSettings } from './db';

export type AlertMode = 'notify' | 'alarm' | 'off';

export function getAlertMode(): AlertMode {
  const v = (getSettings() as any).alert_mode;
  return v === 'alarm' || v === 'off' ? v : 'notify';
}

export async function setAlertMode(mode: AlertMode): Promise<void> {
  await updateSettings({ alert_mode: mode } as any);
  // Android shell: mirror into native prefs so the AlarmReceiver follows it
  // even when the app is closed.
  try {
    (window as any).LifeOSNative?.setAlertMode?.(mode);
  } catch { /* not in the shell */ }
}

/** True when this environment can show a notification of some kind. */
export function alertsSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).LifeOSNative?.notify) return true; // Android bridge
  return typeof Notification !== 'undefined';
}

/** Current notification permission. In the Android shell this asks the
 * native layer (Notification.permission in a WebView always reads 'default'
 * — the WebView cannot see the app's real Android permission). */
export function alertPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported';
  const native = (window as any).LifeOSNative;
  if (native?.notificationPermission) {
    try { return native.notificationPermission(); } catch { /* fall through */ }
  }
  if (native?.notify) return 'granted';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Ask for notification permission where applicable (Android shell: already granted natively). */
export async function requestAlertPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined') return 'unsupported';
  if ((window as any).LifeOSNative?.notify) return 'granted';
  if (typeof Notification === 'undefined') return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/**
 * Deliver the notification for a due alert. `ring` is the callback that
 * starts the in-app alarm — called only when the mode is 'alarm'.
 */
export function deliverAlert(
  key: string,
  title: string,
  body: string,
  ring?: () => void,
): void {
  const mode = getAlertMode();
  if (mode === 'off') return;
  if (mode === 'alarm' && ring) ring();

  // Android shell → native system notification (WebView has no Notification API).
  const native = (window as any).LifeOSNative;
  if (native?.notify) {
    try { native.notify(key, title, body); } catch { /* never crash */ }
    return;
  }
  // Browser / Electron → web Notification.
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, tag: `lifeos-alert-${key}`, icon: '/icons/icon-192.png' });
      n.onclick = () => { try { window.focus(); } catch { /* ignore */ } n.close(); };
    } catch { /* ignore */ }
  }
}
