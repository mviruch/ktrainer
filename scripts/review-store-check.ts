// Run: node --experimental-strip-types scripts/review-store-check.ts
// Optional real IndexedDB semantics: FAKE_IDB=/tmp/fidb/node_modules/fake-indexeddb (installed outside the repo).
import { advance, finishRound, newRound, placeOrder, setPosTpSl } from "../src/lib/engine.ts";
import { exportJson } from "../src/lib/export-json.ts";
import { appendReview, toReview } from "../src/lib/review-store.ts";
import { attachSnaps, collectSnaps, keysToDrop, memorySnapStore, saveSnaps, snapSig, type SnapStore } from "../src/lib/snap-store.ts";
import { idbSnapStore } from "../src/state/idb-snaps.ts";
import type { Bar, Drawn, OrderDraft, Round, RoundLog } from "../src/lib/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("FAIL: " + msg);
}
const M5 = 3e5;
function mkRound(startedAt: number): Round {
  const bars: Bar[] = Array.from({ length: 900 }, (_, i) => ({ t: 1_700_000_000_000 + i * M5, o: 100, h: 100.2, l: 99.8, c: 100, v: 10 + (i % 3) }));
  const d: Drawn = { symbol: "BTCUSDT", interval: "5m", bars, frames: [], ctx: 600 };
  const t = newRound(d, 10000);
  t.startedAt = startedAt;
  return t;
}
const draft = (x: Partial<OrderDraft>): OrderDraft => ({ side: 1, tab: "market", notional: 1000, limit: null, tp: null, sl: null, lev: 5, ...x });

function play(t: Round) {
  placeOrder(t, draft({ sl: 98 }), "cross", { view: "5m", inds: [{ id: 1, kind: "RSI", params: { period: 14 } }] });
  advance(t, 5, "cross");
  placeOrder(t, draft({ notional: 500 }), "cross");
  setPosTpSl(t, null, 99);
  placeOrder(t, draft({ tab: "limit", limit: 90 }), "cross"); // pending: its snapshot must persist too
  advance(t, 5, "cross");
}

async function storeSuite(name: string, mk: () => SnapStore) {
  const st = mk();
  // live round: write, "refresh" (fresh Round object without snaps), read back
  const t = mkRound(1000);
  play(t);
  await saveSnaps(st, t);
  const fresh: Round = JSON.parse(JSON.stringify({ ...t, fills: t.fills.map((f) => ({ ...f, snap: undefined })), orders: t.orders.map((o) => ({ ...o, snap: undefined })) }));
  assert(fresh.fills.every((f) => !f.snap), "stripped");
  const n = attachSnaps(fresh, await st.get(1000));
  assert(n === t.fills.length + t.orders.length && n === 3, `${name}: restored ${n}`);
  assert(JSON.stringify(fresh.fills[0].snap) === JSON.stringify(t.fills[0].snap), `${name}: snapshot identical`);
  assert(fresh.orders[0].snap?.i === t.orders[0].snap?.i, `${name}: pending order snapshot`);
  assert(snapSig(fresh) === snapSig(t), `${name}: signature stable after restore`);
  // retention: 55 rounds → newest 50 kept, oldest dropped first
  for (let k = 1; k <= 55; k++) {
    const r = mkRound(2000 + k);
    placeOrder(r, draft({}), "cross");
    await saveSnaps(st, r);
  }
  const keys = (await st.keys()).sort((a, b) => a - b);
  assert(keys.length === 50 && keys[0] === 2006 && keys[49] === 2055, `${name}: keep newest 50 (${keys.length}, ${keys[0]})`);
  assert((await st.get(1000)) === null, `${name}: oldest dropped`);
  console.log(`  ${name} ok`);
}

// ---------- pure helpers ----------
assert(JSON.stringify(keysToDrop([5, 1, 3], 2)) === "[1]", "keysToDrop");
assert(keysToDrop([1, 2], 50).length === 0, "keysToDrop under cap");
{
  const t = mkRound(1);
  play(t);
  const rec = collectSnaps(t);
  assert(rec.snaps.length === 3 && new Set(rec.snaps.map((s) => s.oid)).size === 3, "collect dedupes by oid");
  finishRound(t, 5, "cross");
  const rv = toReview(t);
  assert(rv.fills.every((f) => !("snap" in f)), "review has no snapshots");
  assert(rv.fillsCut === 0 && rv.events.length === t.events.length && rv.posStats.length === 1 && Array.isArray(rv.endDrawings), "review content");
  assert(Array.isArray(rv.aggregated) && rv.aggregated.length === 0, "no derived frames → aggregated []");
  {
    const t2 = mkRound(2);
    t2.frames = [{ interval: "15m", bars: [], derived: true }, { interval: "4h", bars: [t2.bars[0]] }, { interval: "1h", bars: [], derived: true }];
    assert(JSON.stringify(toReview(t2).aggregated) === '["15m","1h"]', "aggregated captured from Frame.derived");
  }
  assert(rv.fills[0].oid === t.fills[0].oid && rv.fills[0].view === "5m" && rv.fills[0].sl === 98, "review keeps capture fields");
  t.fills = Array.from({ length: 520 }, () => ({ ...t.fills[0] }));
  assert(toReview(t).fills.length === 500 && toReview(t).fillsCut === 20, "500 cap + fillsCut");
  // append: idempotent per startedAt, keeps 600 by default, never tied to the 50 snapshot cap
  let rows = [] as ReturnType<typeof appendReview>;
  for (let k = 0; k < 120; k++) rows = appendReview(rows, { ...rv, startedAt: k });
  rows = appendReview(rows, { ...rv, startedAt: 5 });
  assert(rows.length === 120 && rows[rows.length - 1].startedAt === 5, "append idempotent, >50 kept");
  assert(appendReview(rows, { ...rv, startedAt: 999 }, 100).length === 100, "trim at keep");
}

// ---------- legacy export unchanged ----------
{
  const { exportJson: oldExport } = await import("/tmp/kt-old/export-json.ts");
  const legacy: RoundLog = {
    ts: 1, symbol: "SOLUSDT", interval: "5m,1h", startW: 10000, endW: 10010, pnl: 10, fees: 1, fills: 1, liqs: 0, maxDD: 0.01, bars: 5,
    reason: "手动结束", peeked: false, t0: 1_700_000_000_000, t1: 1_700_000_300_000, startedAt: 7, base: 123.45,
    list: [{ i: 1, side: 1, tag: "开多", type: "市价", price: 124, n: 1000, fee: 0.5, pnl: 0 }],
  };
  const acc = { wallet: 1, lev: 5, mode: "cross" as const, busts: 0, runN: 0 };
  for (const r of [legacy, { ...legacy, revealed: true }]) {
    assert(exportJson(acc, [], [r]) === oldExport(acc, [], [r]), "exportJson identical to HEAD");
  }
  // Legacy RoundLog shape is unchanged (no fillsCut / capture fields leak into fut-log).
  const keys = Object.keys(legacy).sort().join(",");
  assert(!keys.includes("fillsCut"), "no fillsCut on RoundLog");
}

await storeSuite("memory", memorySnapStore);
if (process.env.FAKE_IDB) {
  const m = await import(process.env.FAKE_IDB + "/build/esm/index.js");
  let n = 0;
  await storeSuite("fake-indexeddb", () => idbSnapStore(new m.IDBFactory(), "t" + n++));
  // write failure surfaces as a rejected promise (shell turns it into a toast)
  const bad = idbSnapStore(new m.IDBFactory(), "bad");
  const orig = m.IDBObjectStore.prototype.put;
  m.IDBObjectStore.prototype.put = function () {
    throw new DOMException("quota", "QuotaExceededError");
  };
  let failed = false;
  await saveSnaps(bad, mkRound(1)).catch(() => (failed = true));
  m.IDBObjectStore.prototype.put = orig;
  assert(failed, "idb put failure rejects");
  console.log("  idb failure rejects ok");
} else console.log("  (FAKE_IDB not set: IndexedDB suite skipped)");
console.log("review-store ok");
