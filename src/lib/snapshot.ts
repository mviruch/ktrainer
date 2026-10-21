/* Order-time review snapshot. Pure TS: no DOM / React. */
import { closedBars } from "./frames.ts";
import { blindBaseOf } from "./format.ts";
import type { CaptureIn, Drawing, IndSnap, Interval, Round, SnapBar, SnapFrame, Snapshot } from "./types.ts";

export const SNAP_SPEC: [Interval, number][] = [
  ["5m", 200],
  ["15m", 100],
  ["1h", 100],
  ["4h", 60],
];

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function snapIndicators(rows: CaptureIn["inds"]): IndSnap[] {
  return (rows ?? []).map((r) => ({ id: r.id, kind: r.kind, params: { ...r.params } }));
}

export function snapDrawings(rows: Drawing[] | undefined): Drawing[] {
  return rows ? (JSON.parse(JSON.stringify(rows)) as Drawing[]) : [];
}

export function snapFrame(round: Round, iv: Interval, want: number, base: number | null): SnapFrame {
  const got = closedBars(round, iv);
  if (got.bars === null) {
    return { interval: iv, want, got: 0, bars: null, reason: `base 周期 ${round.interval} 比 ${iv} 长，本局没有 ${iv} 行情` };
  }
  if (!base) return { interval: iv, want, got: 0, bars: null, reason: "缺 base，无法换算 100 制" };
  const all = got.bars;
  // Same as the chart: volume / mean volume of every played (closed) bar in this interval.
  const avg = all.reduce((a, b) => a + b.v, 0) / (all.length || 1) || 1;
  const k = 100 / base;
  const bars: SnapBar[] = all.slice(-want).map((b) => [b.t, r4(b.o * k), r4(b.h * k), r4(b.l * k), r4(b.c * k), r4(b.v / avg)]);
  const notes = [
    got.derived ? `本局未加载 ${iv}，由 ${round.interval} 聚合` : "",
    bars.length < want ? `已收盘只有 ${bars.length} 根` : "",
  ].filter(Boolean);
  return { interval: iv, want, got: bars.length, bars, reason: notes.length ? notes.join("；") : null };
}

export function takeSnapshot(round: Round, cap?: CaptureIn): Snapshot {
  const i = round.cursor - 1;
  const base = blindBaseOf(round.bars, round.ctx, false);
  return {
    i,
    t: round.bars[i]?.t ?? 0,
    base,
    frames: SNAP_SPEC.map(([iv, n]) => snapFrame(round, iv, n, base)),
    inds: snapIndicators(cap?.inds),
    drawings: snapDrawings(cap?.drawings ?? round.drawings),
  };
}
