// Run: node --experimental-strip-types scripts/export-review-check.ts
import { advance, cancelOrder, finishRound, newRound, placeOrder, setPosTpSl, closePct } from "../src/lib/engine.ts";
import { buildReviewExport, CSV_COLS, REVIEW_FILES, reviewCsv, reviewFiles, reviewJson, reviewSummaryCsv, SUMMARY_COLS } from "../src/lib/export-review.ts";
import { zipFiles } from "../src/lib/zip.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toReview, type ReviewRec } from "../src/lib/review-store.ts";
import { collectSnaps, type SnapRec } from "../src/lib/snap-store.ts";
import { withDerivedFrames } from "../src/lib/frames.ts";
import type { Bar, Drawn, Frame, OrderDraft, Round, RoundLog } from "../src/lib/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("FAIL: " + msg);
}
const M5 = 3e5;
const T0 = Date.UTC(2024, 2, 7, 9, 35); // real market date: 2024-03-07
const P0 = 43123.57;

function mkRound(seed: number, startedAt: number): Round {
  const all: Bar[] = Array.from({ length: 2400 }, (_, i) => {
    const c = +(P0 * (1 + 0.004 * Math.sin((i + seed) / 9) + 0.0013 * Math.cos(i / 3.7))).toFixed(2);
    return { t: T0 + i * M5, o: c, h: +(c * 1.0011).toFixed(2), l: +(c * 0.9989).toFixed(2), c, v: +(1234.567 + ((i * 37) % 911) + seed / 7).toFixed(3) };
  });
  const bars = all.slice(600);
  const agg = (ms: number) => {
    const out: Bar[] = [];
    for (const b of all.filter((x) => x.t < bars[0].t)) {
      const t = Math.floor(b.t / ms) * ms;
      const l = out.at(-1);
      if (!l || l.t !== t) out.push({ ...b, t });
      else Object.assign(l, { h: Math.max(l.h, b.h), l: Math.min(l.l, b.l), c: b.c, v: l.v + b.v });
    }
    return out;
  };
  // 4h fetched; 15m / 1h missing → derived (base-aggregated), exactly as market.drawSession builds it
  const frames: Frame[] = withDerivedFrames([{ interval: "4h", bars: agg(144e5) }], "5m", ["15m", "1h"]);
  const d: Drawn = { symbol: "SOLUSDT", interval: "5m", bars, frames, ctx: 900 };
  const t = newRound(d, 10000);
  t.startedAt = startedAt;
  return t;
}
const draft = (x: Partial<OrderDraft>): OrderDraft => ({ side: 1, tab: "market", notional: 2000, limit: null, tp: null, sl: null, lev: 5, ...x });
const cap = { inds: [{ id: 1, kind: "EMA", params: { period: 60 } }] };

/** Same fields as persist.toLog (which can't load in node because of the talib wasm import). */
function logOf(t: Round, revealed: boolean): RoundLog {
  return {
    ts: Date.now(), symbol: t.symbol, interval: [t.interval, ...t.frames.map((f) => f.interval)].join(","), startW: +t.startWallet.toFixed(2), endW: +t.wallet.toFixed(2),
    pnl: +(t.wallet - t.startWallet).toFixed(2), fees: +t.fees.toFixed(2), fills: t.fills.length, liqs: t.liqs, maxDD: +t.maxDD.toFixed(4), bars: t.cursor - t.ctx,
    reason: "手动结束", peeked: false, t0: t.bars[t.ctx - 1].t, t1: t.bars[t.cursor - 1].t, startedAt: t.startedAt, ...(revealed ? { revealed: true } : {}),
    base: t.bars[t.ctx - 1].c,
    list: t.fills.map((f) => ({ i: f.i - t.ctx + 1, side: f.side, tag: f.tag, type: f.type, price: +f.price.toPrecision(8), n: +f.n.toFixed(2), fee: +f.fee.toFixed(4), pnl: +f.pnl.toFixed(2) })),
  };
}

function play(t: Round) {
  const px = () => t.bars[t.cursor - 1].c;
  t.drawings = [{ id: 1, kind: "trend", a: { time: t.bars[t.cursor - 20].t / 1000, time2: 0, price: px() * 0.99 } as never, b: { time: t.bars[t.cursor - 1].t / 1000, price: px() * 1.01 } }];
  placeOrder(t, draft({ tab: "limit", limit: +(px() * 0.97).toFixed(2) }), "cross", cap); // limit + cancel
  cancelOrder(t, t.orders[0].id);
  placeOrder(t, draft({ sl: +(px() * 0.985).toFixed(2) }), "cross", cap); // open with SL
  for (let k = 0; k < 3; k++) advance(t, 5, "cross");
  placeOrder(t, draft({ notional: 1000 }), "cross", cap); // add
  if (t.pos) setPosTpSl(t, null, +(px() * 0.99).toFixed(2)); // move SL
  for (let k = 0; k < 3; k++) advance(t, 5, "cross");
  if (t.pos) closePct(t, 0.5, 5, "cross", cap); // partial
  for (let k = 0; k < 2; k++) advance(t, 5, "cross");
  finishRound(t, 5, "cross"); // round end close
  t.done = true;
}

const rounds: { t: Round; log: RoundLog; rv: ReviewRec; snap: SnapRec | null }[] = [];
const mk = (seed: number, startedAt: number, revealed: boolean, keepSnap: boolean, dropBase = false) => {
  const t = mkRound(seed, startedAt);
  play(t);
  const log = logOf(t, revealed);
  if (dropBase) delete log.base;
  rounds.push({ t, log, rv: toReview(t), snap: keepSnap ? collectSnaps(t) : null });
};
mk(1, 1001, true, true); // A revealed
mk(2, 1002, false, true); // B reveal failed
mk(3, 1003, false, true, true); // C missing base
mk(4, 900, false, false); // D snapshots pruned (oldest)
mk(5, 1005, false, false); // E snapshots not found (recent)
// round E stands in for a record written before aggregated existed
delete rounds[4].rv.aggregated;
const recs = new Map(rounds.filter((r) => r.snap).map((r) => [r.rv.startedAt, r.snap!]));
// D is older than the 50 kept rounds; E is newer than the oldest kept one.
const keys = [...recs.keys(), ...Array.from({ length: 47 }, (_, k) => 1010 + k)]; // 50 kept, oldest 1001
const legacyOnly: RoundLog = { ...rounds[1].log, startedAt: 999 }; // old round w/o fut-review → not exported
const x = buildReviewExport([legacyOnly, ...rounds.map((r) => r.log)], rounds.map((r) => r.rv), { recs, keys, keep: 50 });
const json = reviewJson(x);
const csv = reviewCsv(x);

assert(x.rounds.length === 5 && !x.rounds.some((r) => r.round_id === 999), "only rounds with fut-review");
const [A, B, C, D, E] = x.rounds;
// structure
assert(A.reveal_status === "revealed" && A.symbol === "SOLUSDT" && A.real_t0 && A.fills[0].real, "revealed: symbol/real");
assert(B.reveal_status === "blind" && B.symbol === "HIDDEN" && x.rounds.every((r) => r.reveal_status === "revealed" || r.symbol === "HIDDEN") && !("real_t0" in B) && B.fills.every((f) => !("real" in f)), "blind: no real");
assert(JSON.stringify(A.aggregated_timeframes) === '["15m","1h"]' && JSON.stringify(B.aggregated_timeframes) === '["15m","1h"]', "aggregated_timeframes from Frame.derived");
assert(E.aggregated_timeframes === null, "old record → aggregated_timeframes null");
assert(!csv.includes("aggregated"), "CSV unchanged (no aggregated column)");
assert(A.d0 === "D0 00:00" && /^D\d+ \d\d:\d\d$/.test(A.t1!), "D clock");
const kinds = A.events.map((e) => e.kind + ":" + e.src).join(",");
assert(kinds.startsWith("place:limit,cancel:manual,trigger:market,tpsl:order,trigger:market,tpsl:manual,trigger:market"), "event stream " + kinds);
assert(A.fills.map((f) => f.open_close).join(",") === "open,add,close,close" && A.fills.at(-1)!.close_reason === "round_end", "open/close " + A.fills.map((f) => f.open_close + ":" + f.close_reason));
assert(A.fills[0].bar_index === rounds[0].log.list[0].i - 1 + 1 && A.fills[0].bar_index === rounds[0].t.fills[0].i - (rounds[0].t.ctx - 1), "bar_index = legacy relative index");
assert(A.positions.length === 1 && A.positions[0].initial_risk_100 != null && A.positions[0].r_multiple != null && A.positions[0].adds === 1, "position R");
assert(!json.includes("initial_risk_r") && !csv.includes("initial_risk_r") && csv.split("\n")[0].includes("pos_initial_risk_100"), "renamed initial_risk_100");
{
  const p = A.positions[0];
  const s = rounds[0].t.posStats[0];
  assert(p.risk_u_max != null && p.risk_u_max >= p.risk_u!, "risk_u_max ≥ risk_u");
  assert(p.r_multiple_net != null && p.r_multiple_net < p.r_multiple!, "net R below gross (fees)");
  assert(p.fees != null && Math.abs(p.fees - rounds[0].t.fills.reduce((a, f) => a + f.fee, 0)) < 1e-3, "position fees");
  assert(p.mfe_bar === (s.mfeI == null ? null : s.mfeI - (rounds[0].t.ctx - 1)) && p.mae_bar === (s.maeI == null ? null : s.maeI - (rounds[0].t.ctx - 1)), "mfe/mae bar on fill axis");
  assert(p.mfe_bar == null || (p.mfe_bar > p.open_bar && p.mfe_bar <= p.close_bar!), "mfe bar after open bar");
}
// trigger events carry qty_100 / notional_u (= the fill of the same order id); others null
for (const e of A.events) {
  if (e.kind !== "trigger") assert(e.qty_100 === null && e.notional_u === null, "non-trigger qty null");
  else {
    const f = A.fills.find((x) => x.order_id === e.order_id)!;
    assert(e.qty_100 === f.qty_100 && e.notional_u === f.notional_u && e.qty_100 != null, "trigger qty_100 = fill " + e.order_id);
  }
}
// bar_index: fill and snapshot share one axis (0 = opening bar)
assert(A.fills.every((f) => !f.snapshot || f.snapshot.bar_index === f.bar_index), "snapshot.bar_index == fill.bar_index for orders filled at once");
// round_bars
{
  const t = rounds[0].t;
  assert(A.round_bars && A.round_bars.length === t.cursor - t.ctx + 1 && A.round_bars[0].bar_index === 0 && A.round_bars[0].d_time === "D0 00:00", "round_bars D0 → end");
  assert(A.round_bars.at(-1)!.bar_index === A.total_bars && Math.abs(A.round_bars[0].c! - 100) < 1e-9, "round_bars last = total_bars, D0 close = 100");
  const lastReal = t.bars[t.cursor - 1];
  assert(A.round_bars.at(-1)!.real && Math.abs(A.round_bars.at(-1)!.real!.c - lastReal.c) / lastReal.c < 1e-8, "revealed: real prices");
  assert(B.round_bars && B.round_bars.every((b) => !("real" in b)), "blind: no real");
  assert(C.round_bars && C.round_bars.every((b) => b.o === null && b.c === null && !("real" in b)) && C.round_bars_reason === "缺 base", "no base → round_bars prices null " + C.round_bars_reason);
  assert(D.round_bars === null && D.round_bars_reason!.includes("超出"), "pruned → null");
}
// summary CSV + zip
{
  const sum = reviewSummaryCsv(x).replace(/^\uFEFF/, "").split("\n");
  assert(sum[0] === SUMMARY_COLS.join(",") && sum.length === 1 + x.rounds.length, "summary rows");
  const cols = sum[1].split(",").map((v) => v.replace(/^"|"$/g, ""));
  const get = (k: string) => cols[SUMMARY_COLS.indexOf(k as never)];
  assert(+get("pnl") === A.pnl && +get("max_drawdown") === A.max_drawdown && +get("r_sum") === Math.round(A.positions[0].r_multiple! * 1e6) / 1e6, "summary values");
  assert(get("aggregated_timeframes") === "15m|1h" && sum[2].includes('"HIDDEN"'), "summary symbol hidden for blind");
  // aggregated_timeframes column: list → a|b, [] → empty, old record (null) → NA
  const aggCol = (xx: typeof x) => reviewSummaryCsv(xx).replace(/^\uFEFF/, "").split("\n").slice(1).map((l) => l.split(",")[SUMMARY_COLS.indexOf("aggregated_timeframes")]);
  const ei = x.rounds.indexOf(E);
  assert(aggCol(x)[0] === '"15m|1h"' && aggCol(x)[ei] === '"NA"', "summary agg: list / NA " + aggCol(x));
  const x2 = JSON.parse(JSON.stringify(x)) as typeof x;
  x2.rounds[0].aggregated_timeframes = [];
  assert(aggCol(x2)[0] === '""', "summary agg: [] → empty");
  const dir = mkdtempSync(join(tmpdir(), "kz-"));
  const files = reviewFiles(x);
  writeFileSync(join(dir, "r.zip"), zipFiles(files));
  const list = execFileSync("unzip", ["-Z1", join(dir, "r.zip")]).toString().trim().split("\n");
  assert(list.join() === [REVIEW_FILES.json, REVIEW_FILES.fills, REVIEW_FILES.rounds].join(), "zip entries " + list);
  execFileSync("unzip", ["-tq", join(dir, "r.zip")]); // CRC check
  for (const f of files) assert(execFileSync("unzip", ["-p", join(dir, "r.zip"), f.name], { maxBuffer: 1 << 26 }).toString() === f.data, "zip content " + f.name);
}
assert(A.fills[0].snapshot && A.fills[0].snapshot.frames.length === 4, "snapshot present");
const f15 = A.fills[0].snapshot!.frames[1];
assert(f15.interval === "15m" && f15.got === 100 && f15.reason!.includes("聚合"), "15m aggregated from 5m: " + f15.reason + " " + f15.got);
const f1h = A.fills[0].snapshot!.frames[2];
assert(f1h.got < 100 && f1h.got === f1h.bars!.length && f1h.reason!.includes(`只有 ${f1h.got} 根`), "1h short honestly: " + f1h.reason);
assert(A.fills[0].snapshot!.frames.every((f) => f.bars!.every((b) => /^D-?\d+ \d\d:\d\d$/.test(b.d_time!))), "snapshot D times");
assert(A.fills[0].snapshot!.drawings[0].kind === "trend" && "points" in A.fills[0].snapshot!.drawings[0], "drawing converted");
assert(A.end_drawings.length === 1, "end drawings");
assert(A.fills.at(-1)!.snapshot === null && A.fills.at(-1)!.snapshot_reason!.startsWith("自动成交"), "auto fill reason");
assert(C.fills.every((f) => f.fill_price_100 === null && f.qty_100 === null) && C.positions.every((p) => p.entry_100 === null), "no base → null prices");
assert(C.fills[0].snapshot!.frames[0].bars!.every((b) => b.o === null && b.c === null), "no base → snapshot prices null");
assert(D.snapshots_status === "missing" && D.snapshots_reason!.includes("超出最近 50 局"), "pruned reason " + D.snapshots_reason);
assert(E.snapshots_reason === "未找到快照" && E.fills[0].snapshot_reason === "未找到快照", "not found reason");
// qty_100 × fill_price_100 = notional_u
for (const r of [A, B]) for (const f of r.fills) assert(Math.abs((f.notional_u / f.qty_100!) - f.fill_price_100!) < 1e-6 * f.fill_price_100!, "notional_u / qty_100 = 100-base price");
// CSV
const head = csv.replace(/^\uFEFF/, "").split("\n");
assert(head[0] === CSV_COLS.join(",") && head.length === 1 + x.rounds.reduce((a, r) => a + r.fills.length, 0), "csv rows");
assert(!csv.includes("d_time\":") && !/"o":/.test(csv), "csv has no snapshots");
// snake_case keys everywhere
const badKey = (json.match(/"([A-Za-z0-9_]+)":/g) || []).map((k) => k.slice(1, -2)).find((k) => /[A-Z]/.test(k));
assert(!badKey, "snake_case keys: " + badKey);

// ---------- leak search: every blind round ----------
function leaks(text: string, r: (typeof rounds)[number]) {
  const out: string[] = [];
  for (const s of ["SOLUSDT", "SOL"]) if (text.includes(s)) out.push("symbol " + s);
  const times = r.t.bars.map((b) => b.t);
  const dateForms = (ms: number) => {
    const d = new Date(ms);
    const bj = new Date(ms + 8 * 3600e3);
    const iso = d.toISOString();
    const b = bj.toISOString();
    return [iso.slice(0, 10), b.slice(0, 10), b.slice(0, 16).replace("T", " "), iso.slice(0, 16), iso.slice(0, 10).replace(/-/g, "/"), b.slice(0, 10).replace(/-/g, "/"), `${bj.getUTCFullYear()}年`, String(ms), String(Math.floor(ms / 1000))];
  };
  for (const ms of [r.log.t0, r.log.t1, times[0], times.at(-1)!]) for (const s of dateForms(ms)) if (text.includes(s)) out.push("date " + s);
  const nums = new Set((text.match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number));
  for (const ms of times) if (nums.has(ms) || nums.has(Math.floor(ms / 1000))) out.push("ts " + ms);
  const prices = new Set<number>();
  for (const b of r.t.bars) [b.o, b.h, b.l, b.c].forEach((v) => prices.add(v));
  for (const f of r.t.fills) [f.price, f.orderPrice ?? 0, f.tp ?? 0, f.sl ?? 0].forEach((v) => v && prices.add(v));
  for (const e of r.t.events) [e.price ?? 0, e.tp ?? 0, e.sl ?? 0].forEach((v) => v && prices.add(v));
  for (const s of r.t.posStats) [s.entry, s.mfePx, s.maePx, s.sl0 ?? 0].forEach((v) => v && prices.add(v));
  for (const p of prices) {
    if (nums.has(p) || nums.has(+p.toFixed(2)) || nums.has(+p.toPrecision(8))) out.push("price " + p);
    if (text.includes(p.toFixed(1))) out.push("price str " + p.toFixed(1));
  }
  for (const f of r.t.fills) for (const q of [f.qty, +f.qty.toPrecision(6), +f.qty.toFixed(4)]) if (nums.has(q)) out.push("qty " + q);
  for (const b of r.t.bars) if (nums.has(b.v)) out.push("volume " + b.v);
  return out;
}
const summary = reviewSummaryCsv(x);
for (const k of [1, 2, 3, 4]) {
  const r = rounds[k];
  const part = JSON.stringify(x.rounds[k]) + "\n" + summary.split("\n").filter((l) => l.startsWith(`"${r.rv.startedAt}"`)).join("\n");
  const rows = csv.split("\n").filter((l) => l.startsWith(`"${r.rv.startedAt}"`)).join("\n");
  const hit = [...leaks(part, r), ...leaks(rows, r)];
  assert(hit.length === 0, `round ${k} leaks: ${hit.slice(0, 6).join(" | ")}`);
}
// revealed round: real prices allowed, but never real quantity / volume
{
  const r = rounds[0];
  const nums = new Set((JSON.stringify(A).match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number));
  assert(!r.t.fills.some((f) => nums.has(f.qty) || nums.has(+f.qty.toPrecision(6))), "revealed: no real qty");
  assert(!r.t.bars.some((b) => nums.has(b.v)), "revealed: no real volume");
  assert(!/"qty"|"volume"|"vol":/.test(json), "no qty / volume keys");
}
console.log("export-review ok", { rounds: x.rounds.length, fills: x.rounds.reduce((a, r) => a + r.fills.length, 0), jsonKB: Math.round(json.length / 1024) });
