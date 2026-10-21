import { IV_CN, IV_MS, IV_OK } from "./constants.ts";
import type { Bar, Frame, Interval, Round } from "./types.ts";

export function bucketOpen(t: number, ms: number) {
  return Math.floor(t / ms) * ms;
}

export function intervalList(round: Round): Interval[] {
  const have = new Set<Interval>([round.interval]);
  for (const f of round.frames) have.add(f.interval);
  return IV_OK.filter((iv) => have.has(iv));
}

export function activeView(round: Round): Interval {
  const v = round.view || round.interval;
  return intervalList(round).includes(v) ? v : round.interval;
}

export function intervalLabel(raw: string) {
  return raw
    .split(",")
    .filter(Boolean)
    .map((iv) => IV_CN[iv as Interval] || iv)
    .join(" / ");
}

function aggregate(bars: Bar[], ms: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = bucketOpen(b.t, ms);
    const last = out[out.length - 1];
    if (!last || last.t !== t) out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else {
      if (b.h > last.h) last.h = b.h;
      if (b.l < last.l) last.l = b.l;
      last.c = b.c;
      last.v += b.v;
    }
  }
  return out;
}

/* 长周期只显示「收盘时刻 <= 已走到的时刻」的交易所 K 线，外加一根用已揭示基础 K 线拼出来的未收盘柱。
   交易所那根没收盘的柱子里有未来，不能用。 */
function project(round: Round, end: number, iv: Interval): Bar[] {
  const ms = IV_MS[iv];
  const baseMs = IV_MS[round.interval] || ms;
  const n = Math.max(1, Math.min(end, round.bars.length));
  const now = round.bars[n - 1].t + baseMs;
  const frame = round.frames.find((f) => f.interval === iv);
  const agg = aggregate(round.bars.slice(0, n), ms);
  // Derived frame: no exchange bar covers the part before bars[0], so a bucket opening before it is partial → drop.
  if ((!frame || frame.derived) && agg.length && agg[0].t < round.bars[0].t) agg.shift();
  const prefetch = frame?.bars ?? [];
  if (agg.length && agg[0].t + ms <= now) {
    const src = prefetch.find((b) => b.t === agg[0].t);
    if (src) agg[0] = src;
  }
  const first = agg.length ? agg[0].t : Infinity;
  const hist = prefetch.filter((b) => b.t + ms <= first);
  const bars = hist.concat(agg);
  const forming = bars[bars.length - 1];
  if (forming && forming.t + ms > now) return bars;
  return bars.filter((b) => b.t + ms <= now);
}

export type ChartSlice = { bars: Bar[]; cursor: number; end: number; interval: Interval };

export function chartSlice(round: Round, peekEnd: number | null): ChartSlice {
  const iv = activeView(round);
  const end = peekEnd && peekEnd > round.cursor ? Math.min(peekEnd, round.bars.length) : round.cursor;
  if (iv === round.interval) return { bars: round.bars, cursor: round.cursor, end, interval: iv };
  const played = project(round, round.cursor, iv);
  const shown = end === round.cursor ? played : project(round, end, iv);
  return { bars: shown, cursor: Math.min(played.length, shown.length), end: shown.length, interval: iv };
}

/** Bars of `iv` that are fully closed at round.cursor (no forming bar). null = interval not in this round
 *  ("short": shorter than base, "missing": longer frame was not fetched). */
export function closedBars(round: Round, iv: Interval): { bars: Bar[]; derived?: boolean } | { bars: null; why: "short" } {
  const ms = IV_MS[iv];
  const baseMs = IV_MS[round.interval] || ms;
  if (ms < baseMs) return { bars: null, why: "short" };
  const n = Math.max(1, Math.min(round.cursor, round.bars.length));
  const now = round.bars[n - 1].t + baseMs;
  if (iv === round.interval) return { bars: round.bars.slice(0, n) };
  // Same path as the chart (project); a frame that is missing (old saves) or derived is base-aggregated there.
  const frame = round.frames.find((f) => f.interval === iv);
  return { bars: project(round, n, iv).filter((b) => b.t + ms <= now), derived: !frame || !!frame.derived };
}

/** Add a derived (base-aggregated) frame for every wanted interval longer than base that has no fetched frame. */
export function withDerivedFrames(frames: Frame[], base: Interval, wanted: Interval[]): Frame[] {
  const baseMs = IV_MS[base];
  const out = [...frames];
  for (const iv of wanted) if (IV_MS[iv] > baseMs && !out.some((f) => f.interval === iv)) out.push({ interval: iv, bars: [], derived: true });
  return IV_OK.filter((iv) => out.some((f) => f.interval === iv)).map((iv) => out.find((f) => f.interval === iv)!);
}
