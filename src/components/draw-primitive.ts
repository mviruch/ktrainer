import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { fmtNum } from "@/lib/format";
import { channelCornersTP, indexToX, logicalToTime, timeToLogical, xToIndex } from "@/lib/draw-math";
import { DEFAULT_CHANNEL_STYLE, type Anchor, type Drawing, type DrawStyle } from "@/lib/types";

const FIBS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const INK = "#5C7194";
const LIVE = "#B7800F";
const DIM = "#A39E93";
const HANDLE_R = 5;
const HIT_LINE = 8;
const HIT_HANDLE = 10;

type Host = {
  chart: SeriesAttachedParameter<Time>["chart"] | null;
  series: SeriesAttachedParameter<Time>["series"] | null;
  drawings: Drawing[];
  draft: Drawing | null;
  base: number | null;
  selectedId: number | null;
  xOf: (time: number) => number | null;
  yOf: (price: number) => number | null;
};

type Pt = { x: number; y: number };

export type DrawHit =
  | { kind: "shape"; id: number }
  | { kind: "handle"; id: number; handle: "a" | "b" | "c" };

class DrawRenderer implements IPrimitivePaneRenderer {
  host: Host;
  constructor(host: Host) {
    this.host = host;
  }

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
    const { chart, series } = this.host;
    if (!chart || !series) return;
    const shapes = this.host.draft ? [...this.host.drawings, this.host.draft] : this.host.drawings;
    if (!shapes.length) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const width = scope.mediaSize.width;
      const height = scope.mediaSize.height;
      const xOf = (time: number) => this.host.xOf(time);
      const yOf = (price: number) => this.host.yOf(price);
      const label = (price: number) => {
        const shown = this.host.base ? (price / this.host.base) * 100 : price;
        return fmtNum(shown, this.host.base != null);
      };
      ctx.lineWidth = 1;
      ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      for (const shape of shapes) {
        const live = shape === this.host.draft;
        if (shape.kind === "channel") {
          drawChannel(ctx, shape, live, this.host.selectedId === shape.id, xOf, yOf, width);
          continue;
        }
        const color = live ? LIVE : INK;
        if (shape.kind === "hline") {
          const y = yOf(shape.price);
          if (y == null) continue;
          stroke(ctx, color, "solid", 1, 0, y, width, y);
          ctx.fillStyle = color;
          ctx.fillText(label(shape.price), 6, y - 2);
          continue;
        }
        const x1 = xOf(shape.a.time);
        const y1 = yOf(shape.a.price);
        const x2 = xOf(shape.b.time);
        const y2 = yOf(shape.b.price);
        if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
        if (shape.kind === "fib") {
          const left = Math.min(x1, x2);
          for (const f of FIBS) {
            const price = shape.a.price + (shape.b.price - shape.a.price) * f;
            const y = yOf(price);
            if (y == null) continue;
            const strong = f === 0.618 || f === 0.5 || f === 0 || f === 1;
            stroke(ctx, strong ? color : DIM, f !== 0 && f !== 1 ? "dashed" : "solid", 1, left, y, width, y);
            ctx.fillStyle = strong ? color : DIM;
            ctx.fillText(`${f}  ${label(price)}`, left + 4, y - 2);
          }
          dot(ctx, x1, y1, color);
          dot(ctx, x2, y2, color);
          continue;
        }
        const end = shape.kind === "ray" ? rayEnd(x1, y1, x2, y2, width, height) : { x: x2, y: y2 };
        stroke(ctx, color, "solid", 1, x1, y1, end.x, end.y);
        dot(ctx, x1, y1, color);
        dot(ctx, x2, y2, color);
      }
    });
  }
}

function channelStyle(shape: Extract<Drawing, { kind: "channel" }>): DrawStyle {
  return { ...DEFAULT_CHANNEL_STYLE, ...shape.style };
}

/** Channel corners in pixels; geometry is built in time/price space so it is identical on every interval. */
function channelCorners(
  shape: { a: Anchor; b: Anchor; c: Anchor },
  xOf: (t: number) => number | null,
  yOf: (p: number) => number | null,
): { a: Pt; b: Pt; a2: Pt; b2: Pt; offset: Pt } | null {
  const tp = channelCornersTP(shape.a, shape.b, shape.c);
  const pts: Pt[] = [];
  for (const k of [tp.a, tp.b, tp.a2, tp.b2]) {
    const x = xOf(k.time);
    const y = yOf(k.price);
    if (x == null || y == null) return null;
    pts.push({ x, y });
  }
  const [a, b, a2, b2] = pts;
  return { a, b, a2, b2, offset: { x: a2.x - a.x, y: a2.y - a.y } };
}

function drawChannel(
  ctx: CanvasRenderingContext2D,
  shape: Extract<Drawing, { kind: "channel" }>,
  live: boolean,
  selected: boolean,
  xOf: (t: number) => number | null,
  yOf: (p: number) => number | null,
  _width: number,
) {
  const corners = channelCorners(shape, xOf, yOf);
  if (!corners) return;
  const style = channelStyle(shape);
  const color = style.color;
  const offsetLen = Math.hypot(corners.offset.x, corners.offset.y);
  const baselineOnly = live && (!style.fill || offsetLen < 1.5);
  if (baselineOnly) {
    // A→B preview while placing the second point: dashed baseline only.
    stroke(ctx, color, "dashed", style.width, corners.a.x, corners.a.y, corners.b.x, corners.b.y);
    dot(ctx, corners.a.x, corners.a.y, color);
    dot(ctx, corners.b.x, corners.b.y, color);
    return;
  }
  if (style.fill) {
    const alpha = Math.min(0.4, Math.max(0.05, style.fillOpacity));
    ctx.fillStyle = hexAlpha(style.fillColor ?? style.color, alpha);
    ctx.beginPath();
    ctx.moveTo(corners.a.x, corners.a.y);
    ctx.lineTo(corners.b.x, corners.b.y);
    ctx.lineTo(corners.b2.x, corners.b2.y);
    ctx.lineTo(corners.a2.x, corners.a2.y);
    ctx.closePath();
    ctx.fill();
  }
  // Width step (live): solid baseline + dashed parallel; done: both use style.lineStyle.
  const baseLS = live ? "solid" : style.lineStyle;
  const paraLS = live ? "dashed" : style.lineStyle;
  stroke(ctx, color, baseLS, style.width, corners.a.x, corners.a.y, corners.b.x, corners.b.y);
  stroke(ctx, color, paraLS, style.width, corners.a2.x, corners.a2.y, corners.b2.x, corners.b2.y);
  ctx.globalAlpha = 0.35;
  stroke(ctx, color, "solid", 1, corners.a.x, corners.a.y, corners.a2.x, corners.a2.y);
  stroke(ctx, color, "solid", 1, corners.b.x, corners.b.y, corners.b2.x, corners.b2.y);
  ctx.globalAlpha = 1;
  if (selected && !live) {
    handle(ctx, corners.a.x, corners.a.y, color, "A");
    handle(ctx, corners.b.x, corners.b.y, color, "B");
    handle(ctx, corners.a2.x, corners.a2.y, color, "C");
  } else if (live) {
    dot(ctx, corners.a.x, corners.a.y, color);
    dot(ctx, corners.b.x, corners.b.y, color);
    const xc = xOf(shape.c.time);
    const yc = yOf(shape.c.price);
    if (xc != null && yc != null) dot(ctx, xc, yc, color);
  }
}

function hexAlpha(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(41,98,255,${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function stroke(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineStyle: DrawStyle["lineStyle"] | "solid" | "dashed" | "dotted",
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(lineStyle === "dashed" ? [6, 4] : lineStyle === "dotted" ? [2, 3] : []);
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}

function handle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, tag: string) {
  ctx.fillStyle = "#131722";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, HANDLE_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = color;
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(tag, x, y + HANDLE_R + 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
}

function rayEnd(x1: number, y1: number, x2: number, y2: number, width: number, height: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { x: x2, y: y2 };
  const targetX = dx >= 0 ? width : 0;
  const t = Math.abs(dx) < 0.5 ? (dy >= 0 ? height - y1 : 0 - y1) / (dy || 1) : (targetX - x1) / dx;
  const k = Math.max(t, 1);
  return { x: x1 + dx * k, y: y1 + dy * k };
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointInPoly(px: number, py: number, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export class DrawPrimitive implements ISeriesPrimitive<Time> {
  chart: Host["chart"] = null;
  series: Host["series"] = null;
  drawings: Drawing[] = [];
  draft: Drawing | null = null;
  base: number | null = null;
  selectedId: number | null = null;
  /** Bar open times (seconds) on the time scale, index = logical index; step = interval seconds. */
  times: number[] = [];
  step = 60;
  private request: (() => void) | null = null;
  private views: readonly IPrimitivePaneView[];

  constructor() {
    const renderer = new DrawRenderer(this);
    this.views = [{ zOrder: () => "top", renderer: () => renderer }];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.request = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.request = null;
  }

  paneViews() {
    return this.views;
  }

  sync(drawings: Drawing[], draft: Drawing | null, base: number | null, selectedId: number | null = null) {
    this.drawings = drawings;
    this.draft = draft;
    this.base = base;
    this.selectedId = selectedId;
    this.request?.();
  }

  /** Bars currently on the time scale (call after setData / interval switch). */
  setBars(times: number[], stepSec: number) {
    this.times = times;
    this.step = stepSec > 0 ? stepSec : 60;
    this.request?.();
  }

  /** Pixel x of candle i and pixels per bar on the current time scale. */
  private axis(): { coordOf: (i: number) => number | null; spacing: number } | null {
    const ts = this.chart?.timeScale();
    if (!ts || !this.times.length) return null;
    const times = this.times;
    const spacing = ts.options().barSpacing;
    return { coordOf: (i: number) => ts.timeToCoordinate(times[i] as UTCTimestamp), spacing };
  }

  /** Continuous time → x: interpolate between neighbouring candles, extrapolate by interval length outside. */
  xOf(time: number): number | null {
    const ax = this.axis();
    const idx = timeToLogical(this.times, this.step, time);
    if (!ax || idx == null) return null;
    return indexToX(this.times.length, ax.coordOf, ax.spacing, idx);
  }

  yOf(price: number): number | null {
    const series = this.series;
    if (!series) return null;
    const shown = this.base ? (price / this.base) * 100 : price;
    return series.priceToCoordinate(shown);
  }

  /** x → continuous time (inverse of xOf, no bar snapping). Seconds, rounded to 1s. */
  timeAt(x: number): number | null {
    const ax = this.axis();
    if (!ax) return null;
    const idx = xToIndex(this.times.length, ax.coordOf, ax.spacing, x);
    const t = idx == null ? null : logicalToTime(this.times, this.step, idx);
    return t == null ? null : Math.round(t);
  }

  /** Pick in media (CSS pixel) coords relative to the pane. */
  pickAt(x: number, y: number): DrawHit | null {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return null;
    const xOf = (time: number) => this.xOf(time);
    const yOf = (price: number) => this.yOf(price);
    // Prefer handles of selected channel.
    if (this.selectedId != null) {
      const sel = this.drawings.find((d) => d.id === this.selectedId);
      if (sel?.kind === "channel") {
        const h = this.channelHandles(sel, xOf, yOf);
        if (h) {
          for (const key of ["a", "b", "c"] as const) {
            if (Math.hypot(x - h[key].x, y - h[key].y) <= HIT_HANDLE) return { kind: "handle", id: sel.id, handle: key };
          }
        }
      }
    }
    // Shapes front-to-back (last drawn on top).
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const shape = this.drawings[i];
      if (shape.kind === "channel") {
        const c = channelCorners(shape, xOf, yOf);
        if (!c) continue;
        if (
          pointInPoly(x, y, [c.a, c.b, c.b2, c.a2]) ||
          distToSeg(x, y, c.a.x, c.a.y, c.b.x, c.b.y) <= HIT_LINE ||
          distToSeg(x, y, c.a2.x, c.a2.y, c.b2.x, c.b2.y) <= HIT_LINE
        ) {
          return { kind: "shape", id: shape.id };
        }
        continue;
      }
      if (shape.kind === "hline") {
        const yy = yOf(shape.price);
        if (yy != null && Math.abs(y - yy) <= HIT_LINE) return { kind: "shape", id: shape.id };
        continue;
      }
      const x1 = xOf(shape.a.time);
      const y1 = yOf(shape.a.price);
      const x2 = xOf(shape.b.time);
      const y2 = yOf(shape.b.price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
      if (distToSeg(x, y, x1, y1, x2, y2) <= HIT_LINE) return { kind: "shape", id: shape.id };
    }
    return null;
  }

  channelHandles(
    shape: Extract<Drawing, { kind: "channel" }>,
    xOf: (t: number) => number | null,
    yOf: (p: number) => number | null,
  ): { a: Pt; b: Pt; c: Pt } | null {
    const corners = channelCorners(shape, xOf, yOf);
    if (!corners) return null;
    // C handle sits on the parallel corner near A (a2), matching design.
    return { a: corners.a, b: corners.b, c: corners.a2 };
  }

  /** Map media point → Anchor using current series/time scale. */
  anchorAt(x: number, y: number): { time: number; price: number } | null {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return null;
    const shown = series.coordinateToPrice(y);
    const time = this.timeAt(x);
    if (shown == null || time == null) return null;
    const price = this.base ? (Number(shown) * this.base) / 100 : Number(shown);
    return { time, price };
  }
}
