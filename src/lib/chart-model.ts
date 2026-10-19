import { liqPrice } from "./engine";
import { blindBaseOf, displayPrice } from "./format";
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
  style: "solid" | "dashed" | "dotted";
};

export type MarkPoint = { time: number; side: Side; color: string };

export type ChartModel = {
  candles: CandlePoint[];
  volume: VolumePoint[];
  lines: LinePoint[];
  marks: MarkPoint[];
  blind: boolean;
  live: boolean;
};

const UP = "#1E9468";
const DOWN = "#CC4444";

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function buildChartModel(round: Round, peekEnd: number | null, greenUp: boolean): ChartModel {
  const up = greenUp ? UP : DOWN;
  const down = greenUp ? DOWN : UP;
  const blind = !round.done;
  const base = blindBaseOf(round.bars, round.ctx, round.done);
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
      color: rgba(rise ? up : down, faded ? 0.28 : 0.55),
      faded,
    });
  }
  const px = (p: number) => displayPrice(p, base);
  const lines: LinePoint[] = [];
  if (!round.done && round.pos) {
    const P = round.pos;
    lines.push({
      id: "avg",
      price: px(P.entry),
      color: "#6B7785",
      title: P.side > 0 ? "多" : "空",
      style: "solid",
    });
    const lq = liqPrice(round);
    if (lq) lines.push({ id: "liq", price: px(lq), color: "#D07A2E", title: "强平", style: "dashed" });
    if (P.tp) lines.push({ id: "tp", price: px(P.tp), color: up, title: "止盈", style: "dashed" });
    if (P.sl) lines.push({ id: "sl", price: px(P.sl), color: down, title: "止损", style: "dashed" });
  }
  if (!round.done) {
    for (const o of round.orders) {
      lines.push({
        id: "o" + o.id,
        price: px(o.price),
        color: o.side > 0 ? "#2F86C0" : "#9B51E0",
        title: o.side > 0 ? "限价买" : "限价卖",
        style: "dotted",
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
  return { candles, volume, lines, marks, blind, live: !round.done };
}
