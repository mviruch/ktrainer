import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
  type BarPrice,
  type WhitespaceData,
  type SeriesPartialOptions,
  type MouseEventParams,
  type SeriesType,
} from "lightweight-charts";
import { fmtNum, volFmt } from "@/lib/format";
import type { ChartModel } from "@/lib/chart-model";
import { DrawPrimitive } from "@/components/draw-primitive";
import { TvBarSeries, type TvBarData, type TvBarOptions } from "@/components/tv-bars";
import { paneOrder, type PaneBox, type Plot } from "@/lib/indicators";
import type { Anchor, Drawing } from "@/lib/types";

type Props = {
  model: ChartModel | null;
  sessionKey: number;
  peekKey: number;
  cursor: number;
  viewKey: string;
  greenUp: boolean;
  priceBase: number | null;
  drawings: Drawing[];
  draft: Drawing | null;
  plots: Plot[];
  onPanes: (boxes: PaneBox[]) => void;
  onPick: (anchor: Anchor) => void;
  onHover: (anchor: Anchor | null) => void;
  bindFit: (fn: (() => void) | null) => void;
};

type BarApi = ISeriesApi<"Custom", Time, TvBarData | WhitespaceData<Time>, TvBarOptions, SeriesPartialOptions<TvBarOptions>>;

type IndHandle = { id: string; series: ISeriesApi<SeriesType, Time> };

type Api = {
  chart: IChartApi;
  bars: BarApi;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
  lines: IPriceLine[];
  draw: DrawPrimitive;
  indSeries: IndHandle[];
  indKey: string;
};

function fmtAxis(time: Time) {
  if (typeof time !== "number") return "";
  const d = new Date(time * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (hh === "00" && mm === "00") return `${y}-${m}-${day}`;
  return `${m}-${day} ${hh}:${mm}`;
}

const lineStyle = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.SparseDotted };

function measurePanes(chart: IChartApi, plots: Plot[]): PaneBox[] {
  const keys = paneOrder(plots);
  const panes = chart.panes();
  let top = 0;
  return keys.map((pane, i) => {
    const height = panes[i]?.getHeight() ?? 0;
    const box = { pane, top };
    top += height;
    return box;
  });
}

function hexA(hex: string, a: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function readAnchor(chart: IChartApi, bars: BarApi, param: MouseEventParams<Time>, base: number | null): Anchor | null {
  if (!param.point || param.paneIndex) return null;
  const shown = bars.coordinateToPrice(param.point.y);
  const time = chart.timeScale().coordinateToTime(param.point.x);
  if (shown == null || typeof time !== "number") return null;
  return { time, price: base ? (Number(shown) * base) / 100 : Number(shown) };
}

export function KlineChart({
  model,
  sessionKey,
  peekKey,
  cursor,
  viewKey,
  greenUp,
  priceBase,
  drawings,
  draft,
  plots,
  onPanes,
  onPick,
  onHover,
  bindFit,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const pin = useRef(true);
  const viewBars = useRef(140);
  const countRef = useRef(0);
  const ignore = useRef(false);
  const prev = useRef({ session: -1, peek: -1, cursor: -1, view: "" });
  const pickRef = useRef(onPick);
  const hoverRef = useRef(onHover);
  const baseRef = useRef(priceBase);
  const panesRef = useRef(onPanes);
  const plotsRef = useRef(plots);
  useEffect(() => {
    pickRef.current = onPick;
    hoverRef.current = onHover;
    baseRef.current = priceBase;
    panesRef.current = onPanes;
    plotsRef.current = plots;
  });

  const up = greenUp ? "#1E9468" : "#CC4444";
  const down = greenUp ? "#CC4444" : "#1E9468";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#F5F3EE" },
        textColor: "#5E6975",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: "#E7E2D8" }, horzLines: { color: "#E7E2D8" } },
      rightPriceScale: { borderColor: "#E0DBD0" },
      timeScale: { borderColor: "#E0DBD0", rightOffset: 6 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const bars = chart.addCustomSeries<TvBarData, TvBarOptions>(new TvBarSeries());
    bars.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.22 },
      mode: PriceScaleMode.Logarithmic,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const markers = createSeriesMarkers(bars, []);
    const draw = new DrawPrimitive();
    bars.attachPrimitive(draw);
    const onClick = (param: MouseEventParams<Time>) => {
      const anchor = readAnchor(chart, bars, param, baseRef.current);
      if (anchor) pickRef.current(anchor);
    };
    const onMove = (param: MouseEventParams<Time>) => {
      hoverRef.current(readAnchor(chart, bars, param, baseRef.current));
    };
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (ignore.current || !range) return;
      const last = countRef.current - 1;
      const rightSpace = Math.max(0, range.to - last);
      const bars = range.to - range.from - rightSpace;
      if (bars > 8) viewBars.current = bars;
      pin.current = range.to >= last - 0.5;
    });
    api.current = { chart, bars, volume, markers, lines: [], draw, indSeries: [], indKey: "" };
    return () => {
      chart.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const a = api.current;
    const data = model;
    if (!a) return;
    const follow = (count: number) => {
      const bars = Math.max(30, viewBars.current);
      ignore.current = true;
      a.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, count - bars), to: count - 1 + 6 });
      requestAnimationFrame(() => {
        ignore.current = false;
      });
    };
    if (!data || data.candles.length === 0) {
      a.bars.setData([]);
      a.volume.setData([]);
      a.markers.setMarkers([]);
      countRef.current = 0;
      return;
    }
    const count = data.candles.length;
    countRef.current = count;
    a.bars.applyOptions({
      upColor: up,
      downColor: down,
      priceLineVisible: data.live,
      lastValueVisible: data.live,
      priceLineColor: "#8A939D",
      priceLineStyle: LineStyle.SparseDotted,
      priceFormat: { type: "custom", minMove: 0.00000001, formatter: (p: BarPrice) => fmtNum(Number(p), data.blind) },
    });
    a.volume.applyOptions({
      priceFormat: {
        type: "custom",
        minMove: data.blind ? 0.01 : 1,
        formatter: (p: BarPrice) => (data.blind ? Number(p).toFixed(1) + "×" : volFmt(Number(p))),
      },
    });
    a.chart.applyOptions({
      timeScale: {
        visible: !data.blind,
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#E0DBD0",
        tickMarkFormatter: (time: Time) => (data.blind ? "" : fmtAxis(time)),
      },
      localization: { timeFormatter: (time: Time) => fmtAxis(time) },
    });
    a.bars.setData(
      data.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        ...(c.faded ? { color: hexA(c.close >= c.open ? up : down, 0.35) } : {}),
      })),
    );
    a.volume.setData(data.volume.map((v) => ({ time: v.time as UTCTimestamp, value: v.value, color: v.color })));
    a.markers.setMarkers(
      data.marks.map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.side > 0 ? "belowBar" : "aboveBar",
        shape: m.side > 0 ? "arrowUp" : "arrowDown",
        color: m.color,
      })),
    );
    for (const line of a.lines) a.bars.removePriceLine(line);
    a.lines = data.lines
      .filter((l) => Number.isFinite(l.price) && l.price > 0)
      .map((l) =>
        a.bars.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: 1,
          lineStyle: lineStyle[l.style],
          axisLabelVisible: true,
          title: l.title,
        }),
      );
    const sessionChanged = prev.current.session !== sessionKey;
    const peekChanged = peekKey > 0 && prev.current.peek !== peekKey;
    const viewChanged = prev.current.view !== viewKey;
    if (sessionChanged) {
      pin.current = true;
      viewBars.current = 140;
    }
    if (viewChanged) pin.current = true;
    if (peekChanged) {
      pin.current = true;
      viewBars.current = Math.min(Math.max(viewBars.current, count - cursor + 90), count + 20);
    }
    // 新柱由图表自己平移，柱宽不动。这里重设范围会按宽度重算柱宽，看起来像整图在缩放。
    if (pin.current && (sessionChanged || peekChanged || viewChanged || prev.current.session < 0)) follow(count);
    prev.current = { session: sessionKey, peek: peekKey, cursor, view: viewKey };
  }, [model, sessionKey, peekKey, cursor, viewKey, up, down]);

  useEffect(() => {
    api.current?.draw.sync(drawings, draft, priceBase);
  }, [drawings, draft, priceBase]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const key = plots.map((p) => `${p.id}:${p.pane}:${p.style}:${p.color}`).join("|");
    if (a.indKey !== key) {
      for (const item of a.indSeries) a.chart.removeSeries(item.series);
      while (a.chart.panes().length > 1) a.chart.removePane(a.chart.panes().length - 1);
      const paneOf = new Map<string, number>();
      a.indSeries = plots.map((p) => {
        let pane = 0;
        if (p.pane !== "price") {
          const have = paneOf.get(p.pane);
          if (have == null) {
            pane = a.chart.panes().length;
            a.chart.addPane();
            const tall = plots.some((item) => item.pane === p.pane && item.style === "hist");
            a.chart.panes()[pane]?.setHeight(tall ? 112 : 88);
            paneOf.set(p.pane, pane);
          } else pane = have;
        }
        const common = { priceLineVisible: false, lastValueVisible: p.style === "line", title: "" };
        const series: ISeriesApi<SeriesType, Time> =
          p.style === "hist"
            ? a.chart.addSeries(HistogramSeries, common, pane)
            : a.chart.addSeries(LineSeries, { ...common, color: p.color, lineWidth: 1, crosshairMarkerVisible: false }, pane);
        return { id: p.id, series };
      });
      a.indKey = key;
    }
    for (const p of plots) {
      const handle = a.indSeries.find((item) => item.id === p.id);
      if (!handle) continue;
      const rows = p.points.map((pt) => ({ time: pt.time as UTCTimestamp, value: pt.value, color: pt.color }));
      handle.series.setData(rows);
    }
    const frame = requestAnimationFrame(() => {
      const live = api.current;
      if (live) panesRef.current(measurePanes(live.chart, plots));
    });
    return () => cancelAnimationFrame(frame);
  }, [plots]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const watch = new ResizeObserver(() => {
      const live = api.current;
      if (live) panesRef.current(measurePanes(live.chart, plotsRef.current));
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    bindFit(() => {
      const a = api.current;
      if (!a) return;
      pin.current = true;
      viewBars.current = Math.max(countRef.current, 40);
      a.chart.timeScale().fitContent();
    });
    return () => bindFit(null);
  }, [bindFit]);

  return <div ref={ref} className="h-full w-full" />;
}
