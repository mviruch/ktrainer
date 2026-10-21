/* Shell injection layer: IndexedDB implementation of the core SnapStore. */
import type { SnapRec, SnapStore } from "@/lib/snap-store";

const DB = "ktrainer-review";
const ST = "snaps";

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((ok, bad) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}

function done(tx: IDBTransaction) {
  return new Promise<void>((ok, bad) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => bad(tx.error);
    tx.onabort = () => bad(tx.error || new Error("IndexedDB 事务中止"));
  });
}

export function idbSnapStore(factory: IDBFactory = indexedDB, name = DB): SnapStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!db) {
      db = new Promise<IDBDatabase>((ok, bad) => {
        const r = factory.open(name, 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains(ST)) r.result.createObjectStore(ST, { keyPath: "startedAt" });
        };
        r.onsuccess = () => ok(r.result);
        r.onerror = () => bad(r.error);
        r.onblocked = () => bad(new Error("IndexedDB 被占用"));
      });
      db.catch(() => (db = null));
    }
    return db;
  };
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const tx = (await open()).transaction(ST, mode);
    const out = req(fn(tx.objectStore(ST)));
    await done(tx);
    return out;
  };
  return {
    async put(rec: SnapRec) {
      await run("readwrite", (s) => s.put(rec));
    },
    async get(k: number) {
      return ((await run("readonly", (s) => s.get(k))) as SnapRec | undefined) ?? null;
    },
    async keys() {
      return ((await run("readonly", (s) => s.getAllKeys())) as IDBValidKey[]).filter((k): k is number => typeof k === "number");
    },
    async del(k: number) {
      await run("readwrite", (s) => s.delete(k));
    },
    async clear() {
      await run("readwrite", (s) => s.clear());
    },
  };
}
