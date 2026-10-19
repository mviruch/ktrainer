import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { fmtNum } from "@/lib/format";
import type { Drawing } from "@/lib/types";

const FIBS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const INK = "#5C7194";
const LIVE = "#B7800F";
const DIM = "#A39E93";

type Host = {
  chart: SeriesAttachedParameter<Time>["chart"] | null;
  series: SeriesAttachedParameter<Time>["series"] | null;
  drawings: Drawing[];
  draft: Drawing | null;
  base: number | null;
};

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
      const xOf = (time: number) => chart.timeScale().timeToCoordinate(time as UTCTimestamp);
      const yOf = (price: number) => {
        const shown = this.host.base ? (price / this.host.base) * 100 : price;
        return series.priceToCoordinate(shown);
      };
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
        const color = live ? LIVE : INK;
        if (shape.kind === "hline") {
          const y = yOf(shape.price);
          if (y == null) continue;
          stroke(ctx, color, false, 0, y, width, y);
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
            stroke(ctx, strong ? color : DIM, f !== 0 && f !== 1, left, y, width, y);
            ctx.fillStyle = strong ? color : DIM;
            ctx.fillText(`${f}  ${label(price)}`, left + 4, y - 2);
          }
          dot(ctx, x1, y1, color);
          dot(ctx, x2, y2, color);
          continue;
        }
        const end = shape.kind === "ray" ? rayEnd(x1, y1, x2, y2, width, scope.mediaSize.height) : { x: x2, y: y2 };
        stroke(ctx, color, false, x1, y1, end.x, end.y);
        dot(ctx, x1, y1, color);
        dot(ctx, x2, y2, color);
      }
    });
  }
}

function stroke(ctx: CanvasRenderingContext2D, color: string, dash: boolean, x1: number, y1: number, x2: number, y2: number) {
  ctx.strokeStyle = color;
  ctx.setLineDash(dash ? [3, 3] : []);
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
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

export class DrawPrimitive implements ISeriesPrimitive<Time> {
  chart: Host["chart"] = null;
  series: Host["series"] = null;
  drawings: Drawing[] = [];
  draft: Drawing | null = null;
  base: number | null = null;
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

  sync(drawings: Drawing[], draft: Drawing | null, base: number | null) {
    this.drawings = drawings;
    this.draft = draft;
    this.base = base;
    this.request?.();
  }
}
