// LifeOS — IndexedDB cache (single store, keyed by table name)
const DB_NAME = 'lifeos';
const STORE = 'cache';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbp;
}

export async function idbGet<T>(table: string): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(table);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error ?? new Error('idb get failed'));
    });
  } catch {
    return null; // cache miss on any storage problem — app still works online
  }
}

export async function idbSet(table: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, table);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('idb put failed'));
      tx.onabort = () => reject(tx.error ?? new Error('idb put aborted'));
    });
  } catch {
    /* best-effort cache write */
  }
}

export async function idbDel(table: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(table);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'));
    });
  } catch {
    /* ignore */
  }
}

export async function idbWipeUser(prefix: string): Promise<void> {
  try {
    const db = await open();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('idb keys failed'));
    });
    for (const k of keys) {
      if (typeof k === 'string' && k.startsWith(prefix)) await idbDel(k);
    }
  } catch {
    /* ignore */
  }
}

export const cacheKey = (userId: string, table: string) => `${userId}:${table}`;
