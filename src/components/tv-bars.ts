import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type Time,
} from "lightweight-charts";

export type TvBarData = CustomData<Time> & {
  open: number;
  high: number;
  low: number;
  close: number;
  color?: string;
};

export type TvBarOptions = CustomSeriesOptions & {
  upColor: string;
  downColor: string;
};

class TvBarRenderer implements ICustomSeriesPaneRenderer {
  data: PaneRendererCustomData<Time, TvBarData> | null = null;
  options: TvBarOptions | null = null;

  draw(
    target: Parameters<ICustomSeriesPaneRenderer["draw"]>[0],
    priceToCoordinate: Parameters<ICustomSeriesPaneRenderer["draw"]>[1],
  ): void {
    const data = this.data;
    const options = this.options;
    const range = data?.visibleRange;
    if (!data || !options || !range) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const stem = Math.max(1, Math.round(hr));
      const slot = Math.max(1, data.barSpacing) * (data.conflationFactor || 1) * hr;
      const tick = Math.min(Math.round(slot * 0.42), Math.floor(slot * 0.48));
      const showTicks = tick > stem;
      for (let i = range.from; i < range.to; i++) {
        const item = data.bars[i];
        const bar = item?.originalData;
        if (!bar) continue;
        const high = priceToCoordinate(bar.high);
        const low = priceToCoordinate(bar.low);
        const open = priceToCoordinate(bar.open);
        const close = priceToCoordinate(bar.close);
        if (high == null || low == null || open == null || close == null) continue;
        ctx.fillStyle = bar.color ?? (bar.close >= bar.open ? options.upColor : options.downColor);
        const x = Math.round(item.x * hr);
        const stemLeft = x - Math.floor((stem - 1) / 2);
        const yOf = (y: number) => Math.round(y * vr) - Math.floor((stem - 1) / 2);
        const top = Math.min(yOf(high), yOf(low));
        const bot = Math.max(yOf(high), yOf(low)) + stem;
        ctx.fillRect(stemLeft, top, stem, Math.max(stem, bot - top));
        if (!showTicks) continue;
        const openY = yOf(open);
        const closeY = yOf(close);
        const arm = tick - Math.floor(stem / 2);
        ctx.fillRect(x - tick, openY, arm, stem);
        ctx.fillRect(stemLeft + stem, closeY, arm, stem);
      }
    });
  }
}

export class TvBarSeries implements ICustomSeriesPaneView<Time, TvBarData, TvBarOptions> {
  private pane = new TvBarRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this.pane;
  }

  update(data: PaneRendererCustomData<Time, TvBarData>, options: TvBarOptions): void {
    this.pane.data = data;
    this.pane.options = options;
  }

  priceValueBuilder(row: TvBarData): number[] {
    return [row.high, row.low, row.close];
  }

  isWhitespace(data: TvBarData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return (data as TvBarData).open == null;
  }

  defaultOptions(): TvBarOptions {
    return { ...customSeriesDefaultOptions, upColor: "#1E9468", downColor: "#CC4444" };
  }

  conflationReducer(a: { data: TvBarData }, b: { data: TvBarData }): TvBarData {
    const x = a.data;
    const y = b.data;
    return {
      time: y.time,
      open: x.open,
      high: Math.max(x.high, y.high),
      low: Math.min(x.low, y.low),
      close: y.close,
      color: y.color ?? x.color,
    };
  }
}
