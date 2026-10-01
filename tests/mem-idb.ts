// Minimal in-memory IndexedDB shim — just enough surface for src/lib/idb.ts.
// Lets sync/outbox tests run under `node --test` with zero dependencies.
const stores = new Map<string, Map<string, unknown>>();

function storeOf(name: string): Map<string, unknown> {
  let m = stores.get(name);
  if (!m) { m = new Map(); stores.set(name, m); }
  return m;
}

function makeRequest<T>(impl: () => T): any {
  const req: any = {};
  queueMicrotask(() => {
    try {
      const result = impl();
      req.result = result;
      if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
    } catch (e) {
      req.error = e;
      if (typeof req.onerror === 'function') req.onerror({ target: req });
    }
  });
  return req;
}

function makeTx(store: Map<string, unknown>): any {
  const obj: any = {
    get: (key: string) => makeRequest(() => store.get(key) ?? null),
    put: (value: unknown, key: string) => {
      store.set(key, value);
      const req: any = {};
      queueMicrotask(() => {
        if (typeof obj.__oncomplete === 'function') obj.__oncomplete();
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      });
      return req;
    },
    delete: (key: string) => {
      store.delete(key);
      const req: any = {};
      queueMicrotask(() => {
        if (typeof obj.__oncomplete === 'function') obj.__oncomplete();
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      });
      return req;
    },
  };
  return {
    objectStore: () => obj,
    set oncomplete(fn: unknown) { obj.__oncomplete = fn; },
    get oncomplete() { return obj.__oncomplete; },
    onerror: null,
    onabort: null,
  };
}

export function installMemIdb(): void {
  (globalThis as any).indexedDB = {
    open: (_name: string, _version?: number) => makeRequest(() => ({
      objectStoreNames: { contains: () => true },
      createObjectStore: () => {},
      transaction: (_store: string, _mode?: string) => makeTx(storeOf(_store)),
    })),
  };
}

export function resetMemIdb(): void {
  stores.clear();
}
