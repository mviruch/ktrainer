// Run: node --experimental-strip-types scripts/derived-frames-check.ts
// Missing longer frames (new listing / fetch failed) are base-aggregated for the chart, same path as snapshots.
import { advance, newRound } from "../src/lib/engine.ts";
import { activeView, chartSlice, closedBars, intervalList, withDerivedFrames } from "../src/lib/frames.ts";
import { takeSnapshot } from "../src/lib/snapshot.ts";
import type { Bar, Drawn, Interval, Round } from "../src/lib/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("FAIL: " + msg);
}
const MS: Record<string, number> = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5 };
const T0 = Date.UTC(2026, 4, 15, 14, 25); // "listing" mid 1h (14:00) and mid 4h (12:00) bucket

function truth(bars: Bar[], ms: number, from: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / ms) * ms;
    if (t < from) continue;
    const l = out.at(-1);
    if (!l || l.t !== t) out.push({ ...b, t });
    else Object.assign(l, { h: Math.max(l.h, b.h), l: Math.min(l.l, b.l), c: b.c, v: l.v + b.v });
  }
  return out;
}

const bars: Bar[] = Array.from({ length: 1300 }, (_, i) => {
  const c = 50 + Math.sin(i / 11) * 2 + i * 0.001;
  return { t: T0 + i * MS["5m"], o: c - 0.05, h: c + 0.3, l: c - 0.3, c, v: 100 + (i % 17) };
});
const frames = withDerivedFrames([], "5m", ["15m", "1h", "4h"]);
assert(frames.map((f) => f.interval).join() === "15m,1h,4h" && frames.every((f) => f.derived && !f.bars.length), "derived frames added");
assert(withDerivedFrames([{ interval: "4h", bars: [bars[0]] }], "15m", ["5m", "1h", "4h"]).map((f) => f.interval + (f.derived ? "*" : "")).join() === "1h*,4h", "never shorter than base, keeps fetched");
const d: Drawn = { symbol: "NEWUSDT", interval: "5m", bars: bars.map((b) => ({ ...b })), frames, ctx: 400 };
const t: Round = newRound(d, 10000);
assert(intervalList(t).join() === "5m,15m,1h,4h", "views offered: " + intervalList(t));
for (let k = 0; k < 41; k++) advance(t, 5, "cross"); // cursor lands mid 1h / 4h bucket

for (const iv of ["15m", "1h", "4h"] as Interval[]) {
  const ms = MS[iv];
  t.view = iv;
  assert(activeView(t) === iv, "view switch " + iv);
  const now = t.bars[t.cursor - 1].t + MS["5m"];
  const slice = chartSlice(t, null);
  const played = slice.bars.slice(0, slice.cursor);
  // 1) pre-open part base-aggregated, partial first bucket dropped
  assert(played[0].t >= t.bars[0].t && played[0].t % ms === 0, iv + " first bucket starts at/after bars[0]");
  const want = truth(t.bars.slice(0, t.cursor), ms, Math.ceil(t.bars[0].t / ms) * ms);
  assert(played.length === want.length, `${iv} count ${played.length} vs ${want.length}`);
  played.forEach((b, i) => assert(b.t === want[i].t && b.o === want[i].o && b.h === want[i].h && b.l === want[i].l && b.c === want[i].c && b.v === want[i].v, `${iv} bar ${i} = aggregate of revealed bars`));
  // 2) forming bar exists only when cursor is mid-bucket, and it uses revealed bars only
  const last = played.at(-1)!;
  assert((last.t + ms > now) === (now % ms !== 0), iv + " forming bar iff mid-bucket");
  // 3) no future: scramble every unrevealed bar; the played slice must not change
  const before = JSON.stringify(played);
  const saved = t.bars.slice(t.cursor).map((b) => ({ ...b }));
  for (const b of t.bars.slice(t.cursor)) Object.assign(b, { o: 1e6, h: 2e6, l: 1, c: 1e6, v: 1e9 });
  assert(JSON.stringify(chartSlice(t, null).bars.slice(0, slice.cursor)) === before, iv + " no future data");
  saved.forEach((b, i) => Object.assign(t.bars[t.cursor + i], b));
  // 4) chart closed bars == closedBars == snapshot
  const closed = played.filter((b) => b.t + ms <= now);
  const cb = closedBars(t, iv);
  assert(cb.bars && JSON.stringify(cb.bars) === JSON.stringify(closed) && cb.derived === true, iv + " chart == closedBars");
  const snap = takeSnapshot(t).frames.find((f) => f.interval === iv)!;
  const base = t.bars[t.ctx - 1].c;
  const tail = closed.slice(-snap.want);
  assert(snap.got === tail.length && snap.bars!.every((b, i) => b[0] === tail[i].t && Math.abs(b[4] - Math.round((tail[i].c / base) * 1e6) / 1e4) < 1e-9), iv + " snapshot == chart");
  assert(snap.reason!.includes("由 5m 聚合"), iv + " snapshot reason");
}
// peek beyond cursor still projects only up to the peek end
t.view = "1h";
const peek = chartSlice(t, t.cursor + 24);
assert(peek.end >= peek.cursor && peek.bars.every((b) => b.t <= t.bars[t.cursor + 23].t), "peek bounded");
console.log("derived-frames ok");
