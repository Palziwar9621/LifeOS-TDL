// Account-scoped, device-local tour progress. This never writes application data.
export type TutorialStatus = 'active' | 'skipped' | 'completed';
export interface TutorialProgress { status: TutorialStatus; step: number; }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const memory = new Map<string, TutorialProgress>();
const key = (userId: string) => `lifeos.tutorial.v2:${userId}`;

function browserStorage(): StorageLike | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function readTutorialProgress(userId: string, total: number, storage = browserStorage()): TutorialProgress | null {
  let progress: unknown = memory.get(userId);
  try {
    const raw = progress ? null : storage?.getItem(key(userId));
    if (raw) progress = JSON.parse(raw);
  } catch { /* Retain this session's progress if storage is unavailable. */ }
  if (!progress || typeof progress !== 'object') return null;
  const p = progress as TutorialProgress;
  if (!['active', 'skipped', 'completed'].includes(p.status) || !Number.isInteger(p.step) || p.step < 0 || p.step >= total) return null;
  return { status: p.status, step: p.step };
}

export function saveTutorialProgress(userId: string, progress: TutorialProgress, storage = browserStorage()): void {
  memory.set(userId, { ...progress });
  try { storage?.setItem(key(userId), JSON.stringify(progress)); } catch { /* Session-only fallback. */ }
}

export function clearTutorialProgress(userId: string, storage = browserStorage()): void {
  memory.delete(userId);
  try { storage?.removeItem(key(userId)); } catch { /* Session-only fallback. */ }
}
