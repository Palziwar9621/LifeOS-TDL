// LifeOS — cross-device alarm dismissal tracking.
//
// A stopped alarm must never ring again — on ANY device — until its next
// scheduled occurrence. Alarm keys embed the exact occurrence time
// (e.g. `rem:<id>:<due_at>`), so a new occurrence is a new key and rings
// naturally; a dismissed key is dead.
//
// Dismissals are recorded in Supabase (alarm_dismissals) so stopping on one
// device silences it everywhere. The local Set gives instant checks for the
// ring paths; sync with the server happens on boot, on dismissal, and
// periodically while schedulers are running.

import { getClientSafe as getClient, currentUserIdSafe as currentUserId } from './dismissalsClient';

const TABLE = 'alarm_dismissals';

const local = new Set<string>();
let loaded = false;
let lastPull = 0;

/** Is this alarm key stopped (locally or per the shared record)? */
export function isKeyDismissed(key: string): boolean {
  return local.has(key);
}

/** Record a dismissal locally (instant) and push it to the shared store. */
export function dismissKey(key: string): void {
  if (!key) return;
  local.add(key);
  void push(key);
}

async function push(key: string): Promise<void> {
  try {
    const sb = getClient();
    const uid = currentUserId();
    if (!sb || !uid) return;
    await sb.from(TABLE).upsert({ user_id: uid, key }, { onConflict: 'user_id,key' });
  } catch { /* offline — local Set still covers this device */ }
}

/** Pull the shared dismissal list (once at boot, then every 5 min). */
export async function syncDismissals(): Promise<void> {
  try {
    const sb = getClient();
    const uid = currentUserId();
    if (!sb || !uid) return;
    if (loaded && Date.now() - lastPull < 5 * 60_000) return;
    const { data, error } = await sb
      .from(TABLE)
      .select('key')
      .eq('user_id', uid);
    if (error) return;
    for (const row of data ?? []) local.add(row.key);
    loaded = true;
    lastPull = Date.now();
  } catch { /* offline */ }
}

/** Legacy in-memory sets (alarm.ts) funnel through here on boot. */
export function seedLocalDismissals(keys: Iterable<string>): void {
  for (const k of keys) local.add(k);
}
