/* Order-time K-line snapshots: persisted per round through an injected SnapStore (IndexedDB in the shell,
   memory in tests). The core only knows this interface. */
import { roundBarsOf } from "./snapshot.ts";
import type { Round, SnapBar, Snapshot } from "./types.ts";

export const SNAP_KEEP = 50;

export type SnapRec = {
  v: 1;
  startedAt: number;
  /** Last write (ms). */
  at: number;
  done: boolean;
  /** One per order id (a filled limit order and its fill share the id). */
  snaps: { oid: number; snap: Snapshot }[];
  /** Written once the round is done: base bars D0 → round end (see roundBarsOf). Missing on older records. */
  roundBars?: SnapBar[] | null;
};

export interface SnapStore {
  put(rec: SnapRec): Promise<void>;
  get(startedAt: number): Promise<SnapRec | null>;
  keys(): Promise<number[]>;
  del(startedAt: number): Promise<void>;
  clear(): Promise<void>;
}

export function collectSnaps(t: Round): SnapRec {
  const seen = new Map<number, Snapshot>();
  for (const f of t.fills) if (f.snap && f.oid != null && !seen.has(f.oid)) seen.set(f.oid, f.snap);
  for (const o of t.orders) if (o.snap && !seen.has(o.id)) seen.set(o.id, o.snap);
  return {
    v: 1,
    startedAt: t.startedAt,
    at: Date.now(),
    done: !!t.done,
    snaps: [...seen].map(([oid, snap]) => ({ oid, snap })),
    ...(t.done ? { roundBars: roundBarsOf(t) } : {}),
  };
}

/** Cheap change detector so the shell only writes when the snapshot set changed. */
export function snapSig(t: Round) {
  const ids: number[] = [];
  for (const f of t.fills) if (f.snap && f.oid != null) ids.push(f.oid);
  for (const o of t.orders) if (o.snap) ids.push(-o.id);
  return t.startedAt + ":" + (t.done ? 1 : 0) + ":" + ids.join(",");
}

/** Put restored snapshots back on fills / pending orders (by order id). Returns how many were attached. */
export function attachSnaps(t: Round, rec: SnapRec | null): number {
  if (!rec || rec.startedAt !== t.startedAt) return 0;
  const by = new Map(rec.snaps.map((s) => [s.oid, s.snap]));
  let n = 0;
  for (const f of t.fills) {
    const s = f.oid != null ? by.get(f.oid) : undefined;
    if (s && !f.snap) {
      f.snap = s;
      n++;
    }
  }
  for (const o of t.orders) {
    const s = by.get(o.id);
    if (s && !o.snap) {
      o.snap = s;
      n++;
    }
  }
  return n;
}

/** Oldest-first keys beyond the newest `keep` rounds (by startedAt). */
export function keysToDrop(keys: number[], keep = SNAP_KEEP): number[] {
  const sorted = [...keys].sort((a, b) => a - b);
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}

/** Write this round's snapshots, then drop the oldest beyond `keep`. Fills / events live elsewhere and stay. */
export async function saveSnaps(store: SnapStore, t: Round, keep = SNAP_KEEP) {
  await store.put(collectSnaps(t));
  for (const k of keysToDrop(await store.keys(), keep)) await store.del(k);
}

export function memorySnapStore(): SnapStore & { rows: Map<number, SnapRec> } {
  const rows = new Map<number, SnapRec>();
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    rows,
    async put(rec) {
      rows.set(rec.startedAt, clone(rec));
    },
    async get(k) {
      const r = rows.get(k);
      return r ? clone(r) : null;
    },
    async keys() {
      return [...rows.keys()];
    },
    async del(k) {
      rows.delete(k);
    },
    async clear() {
      rows.clear();
    },
  };
}
