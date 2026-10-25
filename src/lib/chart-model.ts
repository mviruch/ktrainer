import { CANDLE_DOWN, CANDLE_UP } from "./constants";
import { breakEvenPrice, liqPrice, priceNow, uPnl } from "./engine";
import { blindBaseOf, displayPrice, sgnU, uFmt } from "./format";
import { bucketOpen, chartSlice } from "./frames";
import { IV_MS } from "./constants";
import type { Round, Side } from "./types";

export type CandlePoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  faded: boolean;
};

export type VolumePoint = { time: number; value: number; color: string; faded: boolean };

export type LinePoint = {
  id: string;
  price: number;
  color: string;
  title: string;
  style: "solid" | "dashed" | "dotted" | "sparse";
  /** Show price on the right axis. Prefer one label (entry); others use title only. */
  axisLabel?: boolean;
  /** Left-side DOM tag text (design: 「多 5x · 均价 … · 盈亏」「强平」「限价买 · 数量」). */
  label?: string;
};

export type MarkPoint = { time: number; side: Side; color: string };

export type ChartModel = {
  candles: CandlePoint[];
  volume: VolumePoint[];
  lines: LinePoint[];
  marks: MarkPoint[];
  /** Unix sec of the live cursor candle (last non-peeked bar); null if none. */
  nowTime: number | null;
  /** First candle unix sec — relative-time origin while blind. */
  t0: number | null;
  blind: boolean;
  live: boolean;
};

const UP = CANDLE_UP;
const DOWN = CANDLE_DOWN;

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Session zero (seconds) for the blind D-day axis: open time of the opening bar (the one whose close = 100),
 * i.e. base-interval bars[ctx - 1]. Shared by every view interval; bars + ctx are persisted, so it survives reload.
 */
export function sessionZero(round: Pick<Round, "bars" | "ctx">): number | null {
  const b = round.bars[round.ctx - 1];
  return b ? Math.floor(b.t / 1000) : null;
}

export function buildChartModel(round: Round, peekEnd: number | null, greenUp: boolean, beLine = true): ChartModel {
  const up = greenUp ? UP : DOWN;
  const down = greenUp ? DOWN : UP;
  const blind = !round.revealed;
  const base = blindBaseOf(round.bars, round.ctx, !!round.revealed);
  const view = chartSlice(round, peekEnd);
  const played = view.bars.slice(0, view.cursor);
  const avg = played.reduce((a, b) => a + b.v, 0) / (played.length || 1) || 1;
  const candles: CandlePoint[] = [];
  const volume: VolumePoint[] = [];
  const times = new Set<number>();
  let last = -1;
  for (let i = 0; i < view.end; i++) {
    const b = view.bars[i];
    const time = Math.floor(b.t / 1000);
    if (time <= last) continue;
    last = time;
    times.add(time);
    const faded = i >= view.cursor;
    const rise = b.c >= b.o;
    candles.push({
      time,
      open: displayPrice(b.o, base),
      high: displayPrice(b.h, base),
      low: displayPrice(b.l, base),
      close: displayPrice(b.c, base),
      faded,
    });
    volume.push({
      time,
      value: blind ? b.v / avg : b.v,
      color: rgba(rise ? up : down, faded ? 0.05 : 0.32),
      faded,
    });
  }
  const px = (p: number) => displayPrice(p, base);
  const lines: LinePoint[] = [];
  if (!round.done && round.pos) {
    const P = round.pos;
    const now = priceNow(round);
    const posColor = P.side > 0 ? up : down;
    // Draw BE under the position line when they overlap so L/S stays readable.
    if (beLine) {
      const be = breakEvenPrice(round) ?? P.entry;
      lines.push({
        id: "be",
        price: px(be),
        color: "#787B86",
        title: "",
        style: "solid",
        axisLabel: true,
      });
    }
    // Position = entry avg (no fees). Left tag: L/S · PnL · notional USDT.
    const notional = Math.abs(P.qty * P.entry);
    lines.push({
      id: "avg",
      price: px(P.entry),
      color: posColor,
      title: "",
      style: "solid",
      axisLabel: true,
      label: `${P.side > 0 ? "L" : "S"} ${P.lev}x · ${sgnU(uPnl(round, now))} · ${uFmt(notional, 0)}`,
    });
    const lq = liqPrice(round);
    // No axis label — far liq stacks / vanishes; chart hides off-range and shows an edge note.
    if (lq) lines.push({ id: "liq", price: px(lq), color: "#F7A600", title: "", style: "dashed", axisLabel: false, label: "强平" });
    if (P.tp) lines.push({ id: "tp", price: px(P.tp), color: up, title: "", style: "sparse", axisLabel: false, label: "止盈" });
    if (P.sl) lines.push({ id: "sl", price: px(P.sl), color: down, title: "", style: "sparse", axisLabel: false, label: "止损" });
  }
  if (!round.done) {
    for (const o of round.orders) {
      lines.push({
        id: "o" + o.id,
        price: px(o.price),
        color: "#B39DDB",
        title: "",
        style: "dashed",
        axisLabel: true,
        label: `${o.side > 0 ? "限价买" : "限价卖"} · ${uFmt(o.qty * o.price, 0)} U`,
      });
    }
  }
  const marks: MarkPoint[] = [];
  const markMs = IV_MS[view.interval] || IV_MS[round.interval];
  for (const f of round.fills) {
    const bar = round.bars[f.i];
    if (!bar) continue;
    const time = Math.floor(bucketOpen(bar.t, markMs) / 1000);
    if (!times.has(time)) continue;
    marks.push({ time, side: f.side, color: f.side > 0 ? up : down });
  }
  // Live cursor candle = last non-faded bar (played end / peek divider).
  let nowTime: number | null = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (!candles[i].faded) {
      nowTime = candles[i].time;
      break;
    }
  }
  return { candles, volume, lines, marks, nowTime, t0: sessionZero(round), blind, live: !round.done };
}
