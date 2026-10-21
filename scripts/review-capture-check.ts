// Run: node --experimental-strip-types scripts/review-capture-check.ts
import { advance, cancelOrder, finishRound, newRound, placeOrder, reversePos, setPosTpSl } from "../src/lib/engine.ts";
import { takeSnapshot } from "../src/lib/snapshot.ts";
import type { Bar, Drawn, Frame, Interval, OrderDraft, Round } from "../src/lib/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("FAIL: " + msg);
}
const near = (a: number | null | undefined, b: number, eps = 1e-6) => a != null && Math.abs(a - b) < eps;
const MS: Record<string, number> = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5 };

function agg(bars: Bar[], ms: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / ms) * ms;
    const l = out[out.length - 1];
    if (!l || l.t !== t) out.push({ ...b, t });
    else {
      l.h = Math.max(l.h, b.h);
      l.l = Math.min(l.l, b.l);
      l.c = b.c;
      l.v += b.v;
    }
  }
  return out;
}

/** Base series of `n` bars (+pre for frames); pre-open frames aggregated from the history before bars[0]. */
function mkDrawn(base: Interval, pre: number, n: number, ctx: number, frameIvs: Interval[]): Drawn {
  const ms = MS[base];
  const T0 = 1_700_006_400_000 - (1_700_006_400_000 % MS["4h"]) + ms * 7; // deliberately not 4H aligned
  const all: Bar[] = Array.from({ length: pre + n }, (_, i) => {
    const c = 100 + Math.sin(i / 7) * 0.5;
    return { t: T0 + i * ms, o: c, h: c + 0.2, l: c - 0.2, c, v: 10 + (i % 5) };
  });
  const bars = all.slice(pre);
  const frames: Frame[] = frameIvs.map((iv) => ({ interval: iv, bars: agg(all, MS[iv]).filter((b) => b.t < bars[0].t) }));
  return { symbol: "BTCUSDT", interval: base, bars, frames, ctx };
}

/** Overwrite upcoming bar k (index cursor) with a scripted OHLC. */
function script(t: Round, o: number, h: number, l: number, c: number) {
  const b = t.bars[t.cursor];
  Object.assign(b, { o, h, l, c });
}
function flatAtCursor(t: Round, p: number) {
  const b = t.bars[t.cursor - 1];
  Object.assign(b, { o: p, h: p, l: p, c: p });
}
const draft = (x: Partial<OrderDraft>): OrderDraft => ({ side: 1, tab: "market", notional: 1000, limit: null, tp: null, sl: null, lev: 5, ...x });
const cap = { view: "15m" as Interval, inds: [{ id: 1, kind: "EMA", params: { period: 60 } }] };

// ---------- 1. long with SL, add, move SL, take profit ----------
{
  const t = newRound(mkDrawn("5m", 4800, 900, 600, ["15m", "1h", "4h"]), 10000);
  flatAtCursor(t, 100);
  t.drawings = [{ id: 1, kind: "hline", price: 101 }];
  assert(placeOrder(t, draft({ sl: 98, tp: 106 }), "cross", cap).ok, "open long");
  const f0 = t.fills[0];
  assert(f0.oid === 1 && f0.view === "15m" && f0.lev === 5 && f0.sl === 98 && f0.tp === 106 && f0.orderPrice === null && f0.reason === null, "fill meta");
  assert(f0.t === t.bars[t.cursor - 1].t, "fill bar time");
  assert(f0.snap && f0.snap.inds[0].kind === "EMA" && f0.snap.drawings.length === 1, "ind/draw snapshot");
  t.drawings[0] = { id: 1, kind: "hline", price: 999 };
  assert((f0.snap!.drawings[0] as { price: number }).price === 101, "drawing snapshot is a copy");
  const s = t.posStats[0];
  const entry = 100 * 1.0001;
  assert(near(s.entry, entry) && s.sl0 === 98 && near(s.risk, entry - 98), "initial R");
  script(t, 100, 101, 99, 100);
  advance(t, 5, "cross");
  flatAtCursor(t, 100);
  assert(placeOrder(t, draft({ notional: 500, sl: 97 }), "cross", cap).ok, "add");
  assert(s.adds === 1 && s.sl0 === 98 && near(s.risk, entry - 98), "add keeps R");
  assert(setPosTpSl(t, 106, 99).ok, "move SL");
  assert(s.sl0 === 98, "move SL keeps R");
  script(t, 100, 103, 99.5, 102);
  advance(t, 5, "cross");
  script(t, 102, 107, 101, 106.5);
  advance(t, 5, "cross");
  assert(!t.pos, "TP closed");
  const last = t.fills[t.fills.length - 1];
  assert(last.reason === "tp" && last.orderPrice === 106 && last.posId === 1 && last.sl === 99 && last.view === null, "tp fill");
  assert(s.reason === "tp" && s.closeI === s.openI + 3 && s.bars === 3, "hold bars");
  assert(near(s.maePx, 99) && near(s.maeR, (entry - 99) / (entry - 98)), "MAE");
  assert(near(s.mfePx, 106 * (1 - 1e-4)) && near(s.mfeR, (106 * 0.9999 - entry) / (entry - 98)), "MFE (exit bar counts up to exit)");
  assert(near(s.rMult, s.pnl / ((entry - 98) * s.qty0)) && s.rMult! > 0, "R multiple");
  const kinds = t.events.map((e) => `${e.kind}:${e.src}`).join(",");
  assert(kinds === "trigger:market,tpsl:order,trigger:market,tpsl:order,tpsl:manual,trigger:tp", "events " + kinds);
  assert(t.events.every((e) => typeof e.i === "number" && e.t === t.bars[e.i].t), "events carry bar + time");
  assert(new Set(t.fills.map((f) => f.oid)).size === t.fills.length, "unique order ids");
}

// ---------- 2. limit place then cancel; no-stop R null ----------
{
  const t = newRound(mkDrawn("5m", 4800, 900, 600, ["15m", "1h", "4h"]), 10000);
  flatAtCursor(t, 100);
  assert(placeOrder(t, draft({ tab: "limit", limit: 95 }), "cross", cap).ok, "limit placed");
  const o = t.orders[0];
  assert(o.snap && o.view === "15m", "order snapshot");
  cancelOrder(t, o.id);
  assert(t.orders.length === 0, "cancelled");
  const [a, b] = t.events;
  assert(a.kind === "place" && a.price === 95 && a.oid === o.id, "place event");
  assert(b.kind === "cancel" && b.oid === o.id && b.why === "手动撤单", "cancel event");
  // limit fill carries the order's snapshot and price
  assert(placeOrder(t, draft({ tab: "limit", limit: 99 }), "cross", cap).ok, "limit 2");
  script(t, 100, 100.2, 98.5, 99.5);
  advance(t, 5, "cross");
  const f = t.fills[0];
  assert(f.type === "限价" && f.orderPrice === 99 && f.snap && f.oid === t.orders.length + 2, "limit fill meta");
  assert(t.posStats[0].risk === null && t.posStats[0].mfeR === null && t.posStats[0].rMult === null, "no stop → R null");
}

// ---------- 3. reverse ----------
{
  const t = newRound(mkDrawn("5m", 4800, 900, 600, ["15m", "1h", "4h"]), 10000);
  flatAtCursor(t, 100);
  placeOrder(t, draft({ sl: 98 }), "cross", cap);
  script(t, 100, 100.5, 99.5, 100.2);
  advance(t, 5, "cross");
  assert(reversePos(t, 5, "cross", cap).ok, "reverse");
  const f = t.fills[1];
  assert(t.posStats.length === 2 && t.posStats[0].reason === "manual" && t.posStats[0].closeI === t.cursor - 1, "old closed");
  assert(t.posStats[1].side === -1 && t.posStats[1].sl0 === null && t.posStats[1].rMult === null, "new pos, no R");
  assert(f.posId === 1 && f.openPosId === 2 && f.reason === "manual" && f.snap, "reverse fill links");
}

// ---------- 4. liquidation ----------
{
  const t = newRound(mkDrawn("5m", 4800, 900, 600, ["15m", "1h", "4h"]), 10000);
  flatAtCursor(t, 100);
  placeOrder(t, draft({ notional: 100000, lev: 100 }), "isolated", cap);
  placeOrder(t, draft({ tab: "limit", limit: 90, notional: 100 }), "isolated", cap);
  script(t, 100, 100, 95, 96);
  advance(t, 100, "isolated");
  const f = t.fills[t.fills.length - 1];
  assert(t.liqs === 1 && f.reason === "liq" && f.type === "强平", "liq fill");
  assert(t.posStats[0].reason === "liq", "liq stat");
  assert(t.events.some((e) => e.kind === "trigger" && e.src === "liq") && t.events.some((e) => e.kind === "cancel" && e.src === "liq"), "liq events");
}

// ---------- 5. round end ----------
{
  const t = newRound(mkDrawn("5m", 4800, 900, 600, ["15m", "1h", "4h"]), 10000);
  flatAtCursor(t, 100);
  placeOrder(t, draft({ side: -1, sl: 103 }), "cross", cap);
  placeOrder(t, draft({ tab: "limit", limit: 90 }), "cross", cap);
  t.drawings = [{ id: 1, kind: "trend", a: { time: 1, price: 1 }, b: { time: 2, price: 2 } }];
  finishRound(t, 5, "cross");
  const f = t.fills[t.fills.length - 1];
  assert(!t.pos && t.orders.length === 0 && f.reason === "round_end" && t.posStats[0].reason === "round_end", "round end close");
  assert(t.events.some((e) => e.kind === "cancel" && e.src === "round_end"), "round end cancel");
  assert(t.endDrawings?.length === 1 && t.endDrawings[0] !== t.drawings[0], "end drawings copy");
}

// ---------- 6. snapshot: sizes, base 15m → no 5m ----------
{
  const t = newRound(mkDrawn("15m", 1600, 900, 600, ["1h", "4h"]), 10000);
  const s = takeSnapshot(t, cap);
  const m5 = s.frames.find((f) => f.interval === "5m")!;
  assert(m5.bars === null && m5.got === 0 && m5.reason!.includes("15m"), "5m empty with reason");
  for (const [iv, n] of [["15m", 100], ["1h", 100], ["4h", 60]] as const) {
    const fr = s.frames.find((f) => f.interval === iv)!;
    assert(fr.got === n && fr.bars!.length === n && fr.reason === null, iv + " count");
  }
}
{
  const t = newRound(mkDrawn("5m", 4800, 900, 600, ["15m", "4h"]), 10000);
  for (let k = 0; k < 37; k++) advance(t, 5, "cross"); // land mid 4H / 1H / 15m bucket
  const s = takeSnapshot(t);
  const now = t.bars[t.cursor - 1].t + MS["5m"];
  assert(s.base === t.bars[t.ctx - 1].c, "base = close of bars[ctx-1]");
  for (const fr of s.frames) {
    if (fr.interval === "1h") {
      // not loaded → aggregated from 5m base; only played bars (ctx 600 + 37) → 53 closed 1h, first partial bucket dropped
      assert(fr.reason!.includes("由 5m 聚合") && fr.got === fr.bars!.length && fr.got < 100 && fr.reason!.includes(`只有 ${fr.got} 根`), "derived 1h " + fr.reason);
      assert(fr.bars![0][0] >= t.bars[0].t && fr.bars!.every((b) => b[0] + MS["1h"] <= now), "derived 1h closed + no partial first bucket");
      const truth = agg(t.bars.slice(0, t.cursor), MS["1h"]).filter((b) => b.t >= t.bars[0].t && b.t + MS["1h"] <= now);
      assert(near(fr.bars!.at(-1)![4], Math.round((truth.at(-1)!.c / s.base!) * 1e6) / 1e4), "derived 1h close matches");
      continue;
    }
    assert(fr.bars!.length === fr.want, fr.interval + " want");
    assert(fr.bars!.every((b) => b[0] + MS[fr.interval] <= now), fr.interval + " has no forming bar");
    const lastClosed = Math.floor(now / MS[fr.interval]) * MS[fr.interval] - MS[fr.interval];
    assert(fr.bars![fr.bars!.length - 1][0] === lastClosed, fr.interval + " ends at last closed bar");
    assert(fr.bars!.every((b, i, a) => i === 0 || b[0] - a[i - 1][0] === MS[fr.interval]), fr.interval + " contiguous");
  }
  // relative price & volume
  const m5 = s.frames[0].bars!;
  const lastBar = t.bars[t.cursor - 1];
  assert(near(m5[m5.length - 1][4], Math.round((lastBar.c / s.base!) * 100 * 1e4) / 1e4), "100-base close");
  assert(m5.every((b) => b[5] > 0.5 && b[5] < 1.5), "relative volume around 1");
  // 15m last closed bar equals true aggregate (no future leak from prefetch)
  const truth = agg(t.bars.slice(0, t.cursor), MS["15m"]).filter((b) => b.t + MS["15m"] <= now).pop()!;
  const got = s.frames[1].bars!.at(-1)!;
  assert(near(got[4], Math.round((truth.c / s.base!) * 1e6) / 1e4) && near(got[2], Math.round((truth.h / s.base!) * 1e6) / 1e4), "15m close/high match");
}

console.log("review-capture ok");
