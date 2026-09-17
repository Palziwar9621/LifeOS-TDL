// LifeOS — Edge Function: send-push
// Runs on a pg_cron schedule (every minute) with the service-role key, finds
// reminders / task alerts / routine alarms that are due right now, and sends
// a Web Push to every stored subscription via the Web Push protocol.
// Also accepts { test: true, user_id } for a manual test push from Settings.
//
// Required secrets (supabase secrets set):
//   VAPID_PUBLIC_KEY    — base64url public key (same as VITE_VAPID_PUBLIC_KEY)
//   VAPID_PRIVATE_KEY   — base64url private key
// (SERVICE_ROLE key arrives automatically in the Authorization header when
//  invoked with verify_jwt; cron sends it explicitly.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { webpush } from 'https://esm.sh/webpush@1';

const enc = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

interface SubRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface DueItem {
  key: string;
  user_id: string;
  title: string;
  body: string;
}

async function dueItems(supabase: any): Promise<DueItem[]> {
  const now = new Date();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'UTC' });
  const items: DueItem[] = [];
  const horizon = new Date(now.getTime() + 60_000); // fire within the next minute
  const backstop = new Date(now.getTime() - 12 * 3600_000); // catch late-but-recent

  // Reminders (incl. snoozed)
  const { data: rems } = await supabase
    .from('reminders')
    .select('id, user_id, title, notes, due_at, snoozed_until, done, deleted')
    .eq('done', false).eq('deleted', false);
  for (const r of rems ?? []) {
    const fireAt = new Date(r.snoozed_until ?? r.due_at).getTime();
    if (fireAt <= horizon.getTime() && fireAt > backstop.getTime()) {
      items.push({
        key: `rem:${r.id}:${r.snoozed_until ?? r.due_at}`,
        user_id: r.user_id,
        title: '⏰ ' + r.title,
        body: r.notes ?? 'Reminder — tap to open LifeOS',
      });
    }
  }

  // Tasks with reminder lead time
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, user_id, title, due_date, due_time, reminder_minutes, status, deleted, archived')
    .not('reminder_minutes', 'is', null)
    .neq('status', 'completed').neq('status', 'cancelled').eq('deleted', false).eq('archived', false);
  for (const t of tasks ?? []) {
    if (!t.due_date) continue;
    const base = new Date(`${t.due_date}T${(t.due_time ?? '09:00').slice(0, 8)}`);
    const fireAt = base.getTime() - (t.reminder_minutes ?? 0) * 60000;
    if (fireAt <= horizon.getTime() && fireAt > backstop.getTime()) {
      items.push({
        key: `task:${t.id}:${t.due_date}:${t.due_time}`,
        user_id: t.user_id,
        title: '⏰ Task due soon',
        body: t.title,
      });
    }
  }

  // Routine tasks with a time of day
  const wd = new Date(`${today}T00:00:00`).getUTCDay();
  const { data: routines } = await supabase
    .from('routine_tasks')
    .select('id, user_id, title, time_of_day, days, weekday, extra_date, archived')
    .eq('archived', false)
    .not('time_of_day', 'is', null);
  const { data: comps } = await supabase
    .from('routine_completions')
    .select('task_id, done_date')
    .eq('done_date', today);
  const doneSet = new Set((comps ?? []).map((c: any) => c.task_id));
  for (const rt of routines ?? []) {
    const days: number[] = rt.days?.length ? rt.days : rt.weekday != null ? [rt.weekday] : [];
    const matches = days.includes(wd) || rt.extra_date === today;
    if (!matches || doneSet.has(rt.id)) continue;
    const fireAt = new Date(`${today}T${rt.time_of_day.slice(0, 8)}`).getTime();
    // routines: only fire within ±2 min of the scheduled time
    if (fireAt <= horizon.getTime() && fireAt > now.getTime() - 2 * 60_000) {
      items.push({
        key: `routine:${rt.id}:${today}`,
        user_id: rt.user_id,
        title: '⏰ Routine time',
        body: rt.title,
      });
    }
  }

  return items;
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  const adminKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // Accept: cron (service role bearer), or a signed-in user's JWT for test pushes.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    adminKey,
    { auth: { persistSession: false } },
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: 'VAPID secrets not set' }), { status: 500 });
  }

  // Verify the caller: either service-role or an authenticated user asking for a test.
  const token = auth.replace('Bearer ', '');
  const isService = token === adminKey;
  if (!isService) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? adminKey);
    const { data } = await asUser.auth.getUser(token);
    if (!data?.user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    body.user_id = data.user.id; // force test push to caller's own devices
    body.test = true;
  }

  // Pick subscriptions.
  let subs: SubRow[] = [];
  let items: DueItem[] = [];
  if (body.test) {
    const { data } = await supabase.from('push_subscriptions').select('*').eq('user_id', body.user_id);
    subs = data ?? [];
    items = [{ key: `test:${Date.now()}`, user_id: body.user_id, title: '🔔 LifeOS test alarm', body: 'Push works! Alarms will now ring even with the app closed.' }];
  } else {
    items = await dueItems(supabase);
    // Skip already-fired keys.
    if (items.length) {
      const keys = items.map((i) => i.key);
      const { data: fired } = await supabase.from('alarm_fires').select('key').in('key', keys);
      const firedSet = new Set((fired ?? []).map((f: any) => f.key));
      items = items.filter((i) => !firedSet.has(i.key));
    }
    if (items.length) {
      const { data } = await supabase.from('push_subscriptions')
        .select('*').in('user_id', [...new Set(items.map((i) => i.user_id))]);
      subs = data ?? [];
    }
  }
  if (!subs.length || !items.length) {
    return new Response(JSON.stringify({ sent: 0, items: items.length }), { status: 200 });
  }

  let sent = 0;
  const deadEndpoints: string[] = [];
  const perUser = new Map<string, DueItem[]>();
  for (const item of items) {
    const list = perUser.get(item.user_id) ?? [];
    list.push(item);
    perUser.set(item.user_id, list);
  }

  for (const sub of subs) {
    for (const item of perUser.get(sub.user_id) ?? []) {
      const payload = JSON.stringify({
        title: item.title,
        body: item.body,
        key: item.key,
        kind: item.key.split(':')[0],
        url: '/',
      });
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          enc.encode(payload) as any,
          {
            vapidDetails: {
              subject: 'mailto:alarms@lifeos.app',
              publicKey: vapidPublic,
              privateKey: vapidPrivate,
            },
            TTL: 300,
            urgency: 'high',
          } as any,
        );
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) deadEndpoints.push(sub.endpoint);
      }
    }
  }

  // Mark fired + clean up dead subscriptions.
  if (items.length && !body.test) {
    await supabase.from('alarm_fires').upsert(items.map((i) => ({ key: i.key })), { onConflict: 'key' });
  }
  for (const ep of deadEndpoints) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', ep);
  }

  return new Response(JSON.stringify({ sent, dead: deadEndpoints.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
