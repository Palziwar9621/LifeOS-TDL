// LifeOS — Guest Mode.
// A first-class local-only identity: guest data lives ONLY in IndexedDB under
// the `guest:` prefix, never synced, never uploaded. Reuses the existing
// local-first store (db.ts works against any uid) by giving the store a
// synthetic guest id and forcing DEMO-style "no server" behavior.
import { idbGet, idbSet, idbDel } from './idb';

const GUEST_KEY = 'lifeos.guest';
export const GUEST_ID = 'guest:local';

export interface GuestRecord {
  id: string;          // stable per-browser guest id (random, not account-linked)
  createdAt: string;
}

/** True when the current session is a local-only guest (not #demo). */
export function isGuest(): boolean {
  try { return localStorage.getItem(GUEST_KEY) === '1'; } catch { return false; }
}

/** Enter guest mode: creates a persistent per-browser guest identity. */
export function startGuest(): GuestRecord {
  let id = '';
  try {
    const raw = localStorage.getItem(GUEST_KEY + '.id');
    if (raw) {
      id = raw;
    } else {
      id = 'guest:' + crypto.randomUUID();
      localStorage.setItem(GUEST_KEY + '.id', id);
    }
    localStorage.setItem(GUEST_KEY, '1');
  } catch {
    id = 'guest:' + crypto.randomUUID(); // storage blocked — ephemeral guest
  }
  return { id, createdAt: new Date().toISOString() };
}

/** The active guest id (only meaningful when isGuest()). */
export function guestId(): string {
  try { return localStorage.getItem(GUEST_KEY + '.id') ?? GUEST_ID; } catch { return GUEST_ID; }
}

/** Sign out of guest mode. Keeps the guest identity + IndexedDB rows by
 * default so the user can return or migrate later; pass forgetData=true
 * only when the user explicitly asks to discard local guest data. */
export function exitGuest(forgetData = false): void {
  try {
    localStorage.removeItem(GUEST_KEY);
    if (forgetData) {
      localStorage.removeItem(GUEST_KEY + '.id');
      localStorage.removeItem(GUEST_KEY + '.migrated');
    }
  } catch { /* ignore */ }
}

/** Stash guest rows before migration so nothing is lost if migration fails midway. */
export async function snapshotGuest(rows: Record<string, any[]>): Promise<void> {
  await idbSet('guest-migration-backup', rows);
}

export function getGuestBackup(): Promise<Record<string, any[]> | null> {
  return idbGet<Record<string, any[]>>('guest-migration-backup');
}

export async function clearGuestBackup(): Promise<void> {
  await idbDel('guest-migration-backup');
}

/** Tables copied during guest → account migration (must match migrateGuest.ts). */
export const MIGRATION_TABLES = [
  'categories', 'tags', 'projects', 'project_milestones', 'goals', 'goal_milestones',
  'routine_tasks', 'schedule_blocks', 'notes', 'ideas', 'remember_items', 'reminders',
  'tasks', 'subtasks', 'task_tags', 'focus_sessions',
] as const;

/** Gather everything a guest owns, from wherever it currently lives:
 * 1. the live store (guest session still mounted),
 * 2. the per-guest IndexedDB cache (guest signed out — store was reset,
 *    but cached rows survive under `guest:<id>:<table>`),
 * 3. the pre-auth migration backup written by snapshotGuest().
 * Returns rows keyed by table; tables with no data come back as []. */
export async function collectGuestSnapshot(): Promise<Record<string, any[]>> {
  const { dbState } = await import('./db');
  const tables = MIGRATION_TABLES as readonly string[];
  const s = dbState() as any;
  const live: Record<string, any[]> = {};
  for (const t of tables) live[t] = Array.isArray(s?.[t]) ? s[t] : [];
  if (Object.values(live).some((rows) => rows.length > 0)) return live;

  // Live store empty — read the guest's cached rows straight from IndexedDB.
  const gid = guestId();
  const cached: Record<string, any[]> = {};
  for (const t of tables) {
    const rows = await idbGet<any[]>(`${gid}:${t}`);
    cached[t] = rows ?? [];
  }
  if (Object.values(cached).some((rows) => rows.length > 0)) return cached;

  // Last resort: the durable pre-auth backup (if one was written).
  const backup = await getGuestBackup();
  if (backup) return backup;
  return cached;
}
