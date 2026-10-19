import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
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
  type MouseEventParams,
  type SeriesType,
} from "lightweight-charts";
import { fmtNum, volFmt } from "@/lib/format";
import type { ChartModel } from "@/lib/chart-model";
import { DrawPrimitive } from "@/components/draw-primitive";
import { NowPrimitive } from "@/components/now-primitive";
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

type BarApi = ISeriesApi<"Candlestick">;

type IndHandle = { id: string; series: ISeriesApi<SeriesType, Time> };

type Api = {
  chart: IChartApi;
  bars: BarApi;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
  lines: IPriceLine[];
  draw: DrawPrimitive;
  now: NowPrimitive;
  indSeries: IndHandle[];
  indKey: string;
};

/** Axis / crosshair time in Asia/Shanghai (北京时间), matching result panel. */
function fmtAxis(time: Time) {
  if (typeof time !== "number") return "";
  // Same +8 offset as bjDate; Beijing has no DST.
  const d = new Date(time * 1000 + 8 * 3600e3);
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


function resetPriceScale(bars: BarApi) {
  bars.priceScale().applyOptions({
    autoScale: true,
    scaleMargins: { top: 0.08, bottom: 0.22 },
    mode: PriceScaleMode.Normal,
  });
  bars.priceScale().setAutoScale(true);
}

/** True when price sits outside the *visible* scale (clipped), not only outside candle extrema. */
function priceOffScreen(bars: BarApi, chart: IChartApi, price: number): "up" | "down" | null {
  const y = bars.priceToCoordinate(price);
  const paneH = chart.panes()[0]?.getHeight() ?? 0;
  if (y == null || paneH <= 0) return null;
  if (y < 2) return "up";
  if (y > paneH - 2) return "down";
  return null;
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
  const priceDrag = useRef(false);
  const prev = useRef({ session: -1, peek: -1, cursor: -1, view: "", blind: null as boolean | null });
  const [edgeNote, setEdgeNote] = useState<{ dir: "up" | "down"; label: string; color: string } | null>(null);
  const liqEdgeRef = useRef<{ price: number; label: string; color: string; lo: number; hi: number } | null>(null);
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

  // TradingView dark defaults: teal/red. greenUp=false swaps for China-style (red up / teal down).
  const up = greenUp ? "#37a74c" : "#cf4f5f";
  const down = greenUp ? "#cf4f5f" : "#37a74c";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#787B86",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(42, 46, 57, 0.6)" },
        horzLines: { color: "rgba(42, 46, 57, 0.6)" },
      },
      rightPriceScale: { borderColor: "#2A2E39", borderVisible: true, entireTextOnly: true },
      timeScale: {
        borderColor: "#2A2E39",
        borderVisible: true,
        rightOffset: 12,
        barSpacing: 6,
        minBarSpacing: 3,
      },
      crosshair: {
        // Magnet snaps crosshair to OHLC visually; pick/hover still use raw mouse Y.
        mode: CrosshairMode.Magnet,
        vertLine: {
          width: 1,
          color: "#9598A1",
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2A2E39",
        },
        horzLine: {
          width: 1,
          color: "#9598A1",
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2A2E39",
        },
      },
    });
    const bars = chart.addSeries(CandlestickSeries, {
      upColor: "#37a74c",
      downColor: "#cf4f5f",
      borderVisible: true,
      borderUpColor: "#37a74c",
      borderDownColor: "#cf4f5f",
      wickVisible: true,
      wickUpColor: "#37a74c",
      wickDownColor: "#cf4f5f",
    });
    // Normal (TV default). Blind % prices sit near 100; log is not required for priceBase scaling.
    bars.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.22 },
      mode: PriceScaleMode.Normal,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const markers = createSeriesMarkers(bars, []);
    const draw = new DrawPrimitive();
    const now = new NowPrimitive();
    bars.attachPrimitive(draw);
    bars.attachPrimitive(now);
    const onClick = (param: MouseEventParams<Time>) => {
      const anchor = readAnchor(chart, bars, param, baseRef.current);
      if (anchor) pickRef.current(anchor);
    };
    const onMove = (param: MouseEventParams<Time>) => {
      hoverRef.current(readAnchor(chart, bars, param, baseRef.current));
    };
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    const refreshLiqEdge = () => {
      const live = api.current;
      const pending = liqEdgeRef.current;
      if (!live || !pending) {
        setEdgeNote((prev) => (prev ? null : prev));
        return;
      }
      const offScreen = priceOffScreen(live.bars, live.chart, pending.price);
      const offCandle = pending.price < pending.lo || pending.price > pending.hi;
      if (offScreen || offCandle) {
        const edge = {
          dir: offScreen ?? (pending.price > pending.hi ? "up" : "down"),
          label: pending.label,
          color: pending.color,
        };
        setEdgeNote((prev) => {
          if (prev && prev.dir === edge.dir && prev.label === edge.label && prev.color === edge.color) return prev;
          return edge;
        });
        return;
      }
      setEdgeNote((prev) => (prev ? null : prev));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (ignore.current || !range) return;
      const last = countRef.current - 1;
      const rightSpace = Math.max(0, range.to - last);
      const shown = range.to - range.from - rightSpace;
      if (shown > 8) viewBars.current = shown;
      pin.current = range.to >= last - 0.5;
      requestAnimationFrame(refreshLiqEdge);
    });
    const onPointerDown = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const scaleW = Math.max(bars.priceScale().width(), 48);
      if (ev.clientX >= rect.right - scaleW) priceDrag.current = true;
    };
    const onPointerMove = () => {
      if (priceDrag.current) refreshLiqEdge();
    };
    const onPointerUp = () => {
      if (priceDrag.current) requestAnimationFrame(refreshLiqEdge);
      priceDrag.current = false;
    };
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    api.current = { chart, bars, volume, markers, lines: [], draw, now, indSeries: [], indKey: "" };
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
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
      a.now.sync(null);
      for (const line of a.lines) a.bars.removePriceLine(line);
      a.lines = [];
      countRef.current = 0;
      setEdgeNote(null);
      return;
    }
    const count = data.candles.length;
    countRef.current = count;
    const last = data.candles[data.candles.length - 1];
    const lastColor = last && last.close >= last.open ? up : down;
    a.bars.applyOptions({
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: true,
      wickVisible: true,
      priceLineVisible: data.live,
      lastValueVisible: data.live,
      priceLineColor: data.live ? lastColor : "#787B86",
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
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
        borderColor: "#2A2E39",
        tickMarkFormatter: (time: Time) => (data.blind ? "" : fmtAxis(time)),
      },
      localization: { timeFormatter: (time: Time) => fmtAxis(time) },
    });
    a.bars.setData(
      data.candles.map((c) => {
        const body = c.close >= c.open ? up : down;
        if (!c.faded) {
          return {
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          };
        }
        const faded = hexA(body, 0.16);
        return {
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          color: faded,
          borderColor: faded,
          wickColor: faded,
        };
      }),
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
    // Now line at live cursor candle (peek divider / current bar). Hide once fully settled with no fade.
    const hasFade = data.candles.some((c) => c.faded);
    a.now.sync(data.live || hasFade ? data.nowTime : null);
    for (const line of a.lines) a.bars.removePriceLine(line);
    let hi = -Infinity;
    let lo = Infinity;
    for (const c of data.candles) {
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    const span = hi > lo ? hi - lo : Math.max(Math.abs(hi), 1) * 0.01;
    const pad = span * 0.08;
    // Last live close — hide entry axis label when it would stack on the last-price badge.
    let lastClose: number | null = null;
    for (let i = data.candles.length - 1; i >= 0; i--) {
      if (!data.candles[i].faded) {
        lastClose = data.candles[i].close;
        break;
      }
    }
    liqEdgeRef.current = null;
    a.lines = [];
    for (const l of data.lines) {
      if (!Number.isFinite(l.price) || l.price <= 0) continue;
      if (l.id === "liq") {
        liqEdgeRef.current = {
          price: l.price,
          label: `强 ${fmtNum(l.price, data.blind)}`,
          color: l.color,
          lo: lo - pad,
          hi: hi + pad,
        };
        // Far outside full candle band: skip line (clipped anyway); chevron via applyLiqEdge.
        if (l.price < lo - pad || l.price > hi + pad) continue;
      }
      let showAxis = l.axisLabel === true;
      if (showAxis && l.id === "avg" && lastClose != null && lastClose > 0) {
        if (Math.abs(l.price - lastClose) / lastClose < 0.003) showAxis = false;
      }
      a.lines.push(
        a.bars.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: 1,
          lineStyle: lineStyle[l.style],
          axisLabelVisible: showAxis,
          title: l.title,
        }),
      );
    }
    const applyLiqEdge = () => {
      const pending = liqEdgeRef.current;
      const live = api.current;
      let edge: { dir: "up" | "down"; label: string; color: string } | null = null;
      if (pending && live) {
        const offScreen = priceOffScreen(live.bars, live.chart, pending.price);
        const offCandle = pending.price < pending.lo || pending.price > pending.hi;
        if (offScreen || offCandle) {
          edge = {
            dir: offScreen ?? (pending.price > pending.hi ? "up" : "down"),
            label: pending.label,
            color: pending.color,
          };
        }
      }
      setEdgeNote((prev) => {
        if (!edge && !prev) return prev;
        if (edge && prev && edge.dir === prev.dir && edge.label === prev.label && edge.color === prev.color) return prev;
        return edge;
      });
    };
    // Coordinate space settles after setData / autoscale; refresh once more next frame.
    applyLiqEdge();
    requestAnimationFrame(applyLiqEdge);
    const sessionChanged = prev.current.session !== sessionKey;
    const peekChanged = peekKey > 0 && prev.current.peek !== peekKey;
    const viewChanged = prev.current.view !== viewKey;
    const blindChanged = prev.current.blind !== null && prev.current.blind !== data.blind;
    const cursorAdvanced = prev.current.cursor >= 0 && cursor > prev.current.cursor;
    if (sessionChanged) {
      pin.current = true;
      viewBars.current = 140;
    }
    if (viewChanged) pin.current = true;
    if (peekChanged) {
      // Soft peek: keep NOW readable — modest past + future, not fit-all ~300 bars.
      pin.current = false;
      let nowIdx = -1;
      for (let i = data.candles.length - 1; i >= 0; i--) {
        if (!data.candles[i].faded) {
          nowIdx = i;
          break;
        }
      }
      if (nowIdx < 0) nowIdx = Math.max(0, count - 1);
      const past = 90;
      const future = 110;
      viewBars.current = past + future;
      ignore.current = true;
      a.chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, nowIdx - past),
        to: Math.min(count - 1, nowIdx + future) + 4,
      });
      requestAnimationFrame(() => {
        ignore.current = false;
      });
    }
    // Blind↔real (or new round / peek / view): prices jump scale; force autoscale so candles stay visible.
    if (sessionChanged || peekChanged || viewChanged || blindChanged || prev.current.session < 0) {
      resetPriceScale(a.bars);
    } else if (data.live && pin.current && cursorAdvanced && !priceDrag.current) {
      // Keep last bar in view after a price-axis drag unlocked autoScale.
      a.bars.priceScale().setAutoScale(true);
    }
    // 新柱由图表自己平移，柱宽不动。这里重设范围会按宽度重算柱宽，看起来像整图在缩放。
    // Peek sets its own window around NOW; skip follow so we don't jump to the far right.
    if (pin.current && (sessionChanged || viewChanged || prev.current.session < 0)) follow(count);
    prev.current = { session: sessionKey, peek: peekKey, cursor, view: viewKey, blind: data.blind };
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
      resetPriceScale(a.bars);
    });
    return () => bindFit(null);
  }, [bindFit]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" />
      {edgeNote ? (
        <div
          className={`price-edge-note ${edgeNote.dir === "up" ? "top" : "bot"}`}
          style={{ color: edgeNote.color }}
        >
          <span aria-hidden="true">{edgeNote.dir === "up" ? "▲" : "▼"}</span> {edgeNote.label}
        </div>
      ) : null}
    </div>
  );
}
