// LifeOS — web push: subscribe this device so alarms arrive even when the
// app AND browser are closed. The Supabase Edge Function `send-push` (cron,
// every minute) queries due reminders/tasks/routines and pushes to every
// stored subscription via the Web Push protocol (VAPID).
import { getClient } from './supabase';
import { currentUserId } from './db';

// VAPID public key — hardcoded fallback so push works with zero Vercel env
// config; VITE_VAPID_PUBLIC_KEY still overrides if set.
const BAKED_VAPID_PUBLIC_KEY = 'BLHnWzFTr7eiXJBkMsgpg8Mn7QAaXjwZzJfMEEcWy4GaMm_w-p4akbUja1aUZ69G85fcAQDnzowoVgmGOatpY54';

const VAPID_PUBLIC_KEY =
  (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY ||
  BAKED_VAPID_PUBLIC_KEY ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('lifeos.vapidPublic') || '' : '');

const SUB_TABLE = 'push_subscriptions';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined';
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Register the current device for push, storing the subscription server-side. */
export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'This browser does not support web push.' };
  if (!VAPID_PUBLIC_KEY) return { ok: false, error: 'Missing VAPID public key (VITE_VAPID_PUBLIC_KEY).' };
  const sb = getClient();
  if (!sb) return { ok: false, error: 'Connect to Supabase first.' };
  const uid = currentUserId();
  if (!uid) return { ok: false, error: 'Not signed in.' };

  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'Notification permission was denied.' };

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as any,
      });
    }
    const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
    const { error } = await sb.from(SUB_TABLE).upsert({
      user_id: uid,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Remove this device's subscription (called on sign-out / disable). */
export async function disablePush(): Promise<void> {
  try {
    const sb = getClient();
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (sb) await sb.from(SUB_TABLE).delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch { /* best effort */ }
}

/** Ask the server to send a test push to all of this user's devices. */
export async function sendTestPush(): Promise<{ ok: boolean; error?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, error: 'Connect to Supabase first.' };
  const uid = currentUserId();
  if (!uid) return { ok: false, error: 'Not signed in.' };
  const { error } = await sb.functions.invoke('send-push', { body: { test: true, user_id: uid } });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Register listener for messages from the service worker (alarm taps,
 * snooze/dismiss from push notification actions).
 */
export function onWorkerMessage(handlers: {
  alarm?: (msg: { key: string; kind?: string; title?: string; body?: string }) => void;
  snooze?: (msg: { key: string; kind?: string }) => void;
  dismiss?: (msg: { key: string }) => void;
}): () => void {
  const fn = (event: MessageEvent) => {
    const d: any = event.data || {};
    if (d.type === 'lifeos-alarm') handlers.alarm?.(d);
    else if (d.type === 'lifeos-snooze') handlers.snooze?.(d);
    else if (d.type === 'lifeos-dismiss') handlers.dismiss?.(d);
  };
  navigator.serviceWorker.addEventListener('message', fn);
  return () => navigator.serviceWorker.removeEventListener('message', fn);
}
