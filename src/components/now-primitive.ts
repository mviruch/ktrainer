import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

const LINE = "rgba(214, 218, 228, 0.95)";
const LABEL_BG = "rgba(42, 46, 57, 0.96)";
const LABEL = "#F0F3FA";
const RIGHT_INSET = 56; // keep tag clear of the right price scale

type Host = {
  chart: SeriesAttachedParameter<Time>["chart"] | null;
  nowTime: number | null;
};

class NowRenderer implements IPrimitivePaneRenderer {
  host: Host;
  constructor(host: Host) {
    this.host = host;
  }

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]): void {
    const { chart, nowTime } = this.host;
    if (!chart || nowTime == null) return;
    const x = chart.timeScale().timeToCoordinate(nowTime as UTCTimestamp);
    if (x == null) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const h = scope.mediaSize.height;
      const xx = Math.round(x) + 0.5;
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, h);
      ctx.stroke();
      ctx.setLineDash([]);
      const tag = "NOW";
      ctx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
      const tw = ctx.measureText(tag).width;
      const padX = 5;
      const boxW = tw + padX * 2;
      const boxH = 16;
      const rightLimit = scope.mediaSize.width - RIGHT_INSET;
      // Prefer label to the left of the line when near the price scale.
      let bx = xx + 5;
      if (bx + boxW > rightLimit) bx = xx - boxW - 5;
      if (bx < 2) bx = 2;
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(bx, 2, boxW, boxH);
      ctx.strokeStyle = "rgba(180, 184, 196, 0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, 2.5, boxW - 1, boxH - 1);
      ctx.fillStyle = LABEL;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(tag, bx + padX, 2 + boxH / 2);
    });
  }
}

/** TradingView-style dashed vertical at the live cursor candle. */
export class NowPrimitive implements ISeriesPrimitive<Time> {
  chart: Host["chart"] = null;
  nowTime: number | null = null;
  private request: (() => void) | null = null;
  private views: readonly IPrimitivePaneView[];

  constructor() {
    const renderer = new NowRenderer(this);
    this.views = [{ zOrder: () => "top", renderer: () => renderer }];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.request = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.request = null;
  }

  paneViews() {
    return this.views;
  }

  sync(nowTime: number | null) {
    this.nowTime = nowTime;
    this.request?.();
  }
}
