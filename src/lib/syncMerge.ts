// LifeOS — pure pull-merge semantics, extracted from db.ts so the sync rules
// (local-pending protection, tombstoned deletes, last-write-wins) can be
// regression-tested without a browser or a live backend.
export interface SyncRow { id: string; updated_at?: string | null; }

export interface PendingOps {
  /** Row has an unsynced (non-dead) local op — local state must win. */
  hasPendingOp(table: string, id: string): boolean;
  /** Row has a queued delete — even a parked one — so it must stay deleted. */
  hasQueuedDelete(table: string, id: string): boolean;
}

/**
 * Merge a freshly pulled remote table into the local list.
 * Semantics (must match db.ts pull()):
 *  1. Remote rows the user deleted locally stay deleted — even if the delete
 *     op is parked/dead — so deleted tasks never resurrect after a sync.
 *  2. Remote rows with a live pending local op lose to the local copy
 *     (local wins until flushed).
 *  3. Otherwise last-write-wins on `updated_at`.
 *  4. Local rows that exist only locally but have pending ops (unsynced
 *     inserts) are kept.
 */
export function mergePulledRows<T extends SyncRow>(
  table: string,
  localList: T[],
  remote: T[],
  q: PendingOps
): T[] {
  const pendingIds = new Set(localList.filter((l) => q.hasPendingOp(table, l.id)).map((l) => l.id));
  const remoteIds = new Set(remote.map((r) => r.id));
  const merged: T[] = [];
  for (const r of remote) {
    if (q.hasQueuedDelete(table, r.id)) continue; // tombstoned: keep deleted
    const l = localList.find((x) => x.id === r.id);
    if (!l) { merged.push(r); continue; }
    if (pendingIds.has(r.id)) { merged.push(l); continue; }
    merged.push((r.updated_at ?? '') >= (l.updated_at ?? '') ? r : l);
  }
  for (const l of localList) {
    if (!remoteIds.has(l.id) && pendingIds.has(l.id)) merged.push(l);
  }
  return merged;
}
