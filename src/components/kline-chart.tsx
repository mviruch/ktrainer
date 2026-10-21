import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChartEx,
  defaultHorzScaleBehavior,
  TickMarkType,
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
  type Mutable,
  type TimeScalePoint,
  type TickMarkWeightValue,
} from "lightweight-charts";
import { fmtNum } from "@/lib/format";
import type { ChartModel } from "@/lib/chart-model";
import { DrawPrimitive } from "@/components/draw-primitive";
import { NowPrimitive } from "@/components/now-primitive";
import { paneOrder, type PaneBox, type Plot } from "@/lib/indicators";
import type { Anchor, Drawing } from "@/lib/types";
import type { Tool } from "@/components/chart-tools";

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
  selectedId?: number | null;
  tool?: Tool;
  plots: Plot[];
  /** Sub-pane display mode keyed by Plot.pane ("collapsed" persisted per instance, "max" transient). */
  paneModes?: Record<string, "collapsed" | "max">;
  onPanes: (boxes: PaneBox[]) => void;
  onPick: (anchor: Anchor) => void;
  onHover: (anchor: Anchor | null) => void;
  /** Unix sec of the candle under the crosshair; null when mouse leaves the chart. */
  onHoverBar?: (time: number | null) => void;
  onSelect?: (id: number | null) => void;
  onUpdateDrawing?: (d: Drawing) => void;
  onOpenStyle?: (id: number) => void;
  bindFit: (fn: (() => void) | null) => void;
};

type BarApi = ISeriesApi<"Candlestick">;

/**
 * Root cause of the「MACD 只有 20px」bug: IPaneApi.setHeight() spreads the delta over *all* other panes
 * (including other sub-panes) using their current — often not yet laid out — heights, and it clamps to the
 * library's 30px minimum. Setting panes one by one therefore squeezed earlier sub-panes. Instead, compute
 * every pane's pixel height at once and set stretch factors (relative weights) directly.
 * total = whole pane area (all panes, excluding the time axis).
 */
function applyPaneHeights(a: { chart: IChartApi }, plots: Plot[], modes: Record<string, string>, el: HTMLElement | null) {
  const keys = paneOrder(plots);
  const panes = a.chart.panes();
  if (panes.length < 2 || keys.length !== panes.length) return;
  let total = panes.reduce((sum, pane) => sum + pane.getHeight(), 0);
  if (!(total > 0)) total = (el?.clientHeight ?? 600) - a.chart.timeScale().height();
  const sub = keys.map((k, i) => {
    if (i === 0) return 0;
    const tall = plots.some((item) => item.pane === k && item.style === "hist");
    if (modes[k] === "collapsed") return 26;
    if (modes[k] === "max") return Math.max(26, Math.round(Math.min(total * 0.6, total - 200)));
    return tall ? 112 : 88;
  });
  const main = Math.max(60, total - sub.reduce((x, y) => x + y, 0));
  panes.forEach((pane, i) => pane.setStretchFactor(i === 0 ? main : sub[i]));
  keys.forEach((k, i) => {
    if (i === 0) return;
    // Collapsed: title bar only — no axis ticks. (visible:false on a non-first pane's scale throws
    // "Value is null" inside lightweight-charts' size adjust, so blank the text/ticks instead.)
    const c = modes[k] === "collapsed";
    a.chart.priceScale("right", i).applyOptions({ textColor: c ? "rgba(0,0,0,0)" : "#9598A1", ticksVisible: !c });
  });
}

function lastLive(m: ChartModel): number | null {
  if (!m.live) return null;
  for (let i = m.candles.length - 1; i >= 0; i--) if (!m.candles[i].faded) return m.candles[i].close;
  return null;
}

type Overlay = {
  mask: { left: number; width: number } | null;
  tags: { id: string; y: number; text: string; color: string }[];
  height?: number;
  /** Liquidation right-axis tag (library price-line labels can't be offset, so it's DOM). */
  liq?: { y: number; left: number; width: number; text: string } | null;
};

type IndHandle = { id: string; series: ISeriesApi<SeriesType, Time> };

type Api = {
  chart: IChartApi;
  bars: BarApi;
  markers: ISeriesMarkersPluginApi<Time>;
  lines: IPriceLine[];
  draw: DrawPrimitive;
  now: NowPrimitive;
  indSeries: IndHandle[];
  indKey: string;
  paneKey: string;
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

const DAY = 86400;
const two = (n: number) => String(n).padStart(2, "0");

/** Blind relative clock: D{day} HH:MM elapsed since session t0 — never a real date / weekday / clock. */
function relParts(time: Time, t0: number) {
  if (typeof time !== "number") return null;
  // floor for negatives too: 5 min before zero → day -1, rem 86100 → "D-1 23:55".
  const sec = Math.floor(time - t0);
  const day = Math.floor(sec / DAY);
  const rem = sec - day * DAY;
  return { day, hm: `${two(Math.floor(rem / 3600))}:${two(Math.floor((rem % 3600) / 60))}` };
}

/** Full blind label (crosshair etc.): "D1250 04:00". */
function fmtRelFull(time: Time, t0: number) {
  const r = relParts(time, t0);
  return r ? `D${r.day} ${r.hm}` : "";
}

/**
 * Blind tick label. Tick type comes from RelDayBehavior weights:
 * a relative-day boundary is DayOfMonth weight → "D12" (library draws max-weight ticks bold);
 * intraday ticks → "04:00". When ticks are ≥1 day apart every tick is a day tick → "D125".
 */
function fmtRelTick(time: Time, type: TickMarkType, t0: number) {
  const r = relParts(time, t0);
  if (!r) return "";
  return type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds ? r.hm : `D${r.day}`;
}

const INTRADAY: [number, number][] = [
  [12 * 3600, 33],
  [6 * 3600, 32],
  [3 * 3600, 31],
  [3600, 30],
  [1800, 22],
  [300, 21],
  [60, 20],
];

/** Tick weights from elapsed-since-t0 instead of UTC calendar, so day ticks land on D boundaries. */
function relWeight(cur: number, prev: number): number {
  if (Math.floor(cur / DAY) !== Math.floor(prev / DAY)) return 50; // TickMarkWeight.Day
  for (const [div, w] of INTRADAY) if (Math.floor(cur / div) !== Math.floor(prev / div)) return w;
  return 0;
}

const BaseBehavior = defaultHorzScaleBehavior();
class RelDayBehavior extends BaseBehavior {
  /** Session zero (seconds). null → stock calendar weights. */
  t0: number | null = null;
  fillWeightsForPoints(points: readonly Mutable<TimeScalePoint>[], startIndex = 0): void {
    const t0 = this.t0;
    if (t0 == null || !points.length) return super.fillWeightsForPoints(points, startIndex);
    const at = (i: number) => (points[i].originalTime as number) - t0;
    for (let i = Math.max(startIndex, 1); i < points.length; i++) {
      points[i].timeWeight = relWeight(at(i), at(i - 1)) as TickMarkWeightValue;
    }
    if (startIndex === 0) {
      const step = points.length > 1 ? at(1) - at(0) : 60;
      points[0].timeWeight = relWeight(at(0), at(0) - step) as TickMarkWeightValue;
    }
  }
}

const lineStyle = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted, sparse: LineStyle.SparseDotted };

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
    scaleMargins: { top: 0.08, bottom: 0.08 },
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
  selectedId = null,
  tool = "cursor",
  plots,
  paneModes,
  onPanes,
  onPick,
  onHover,
  onHoverBar,
  onSelect,
  onUpdateDrawing,
  onOpenStyle,
  bindFit,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const behaviorRef = useRef<RelDayBehavior | null>(null);
  // Set zero before any effect calls setData (candles, VOL, indicators all add time points).
  if (behaviorRef.current) behaviorRef.current.t0 = model?.t0 ?? null;
  const api = useRef<Api | null>(null);
  const pin = useRef(true);
  const viewBars = useRef(140);
  const countRef = useRef(0);
  const ignore = useRef(false);
  const priceDrag = useRef(false);
  const prev = useRef({ session: -1, peek: -1, cursor: -1, view: "", blind: null as boolean | null });
  const paneModesRef = useRef(paneModes);
  paneModesRef.current = paneModes;
  const paneSig = JSON.stringify(paneModes ?? {});
  const [overlay, setOverlay] = useState<Overlay>({ mask: null, tags: [] });
  const modelRef = useRef(model);
  modelRef.current = model;
  useEffect(() => {
    // DOM overlays the library can't draw: unplayed-area mask right of NOW and left-side price-line tags.
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const a = api.current;
      const m = modelRef.current;
      const el = ref.current;
      if (!a || !m || !el) {
        if (last !== "0") {
          last = "0";
          setOverlay({ mask: null, tags: [] });
        }
        return;
      }
      const ts = a.chart.timeScale();
      const plotW = el.clientWidth - a.chart.priceScale("right").width();
      const plotH = a.chart.panes()[0]?.getHeight() ?? el.clientHeight;
      let mask: Overlay["mask"] = null;
      if (m.nowTime != null) {
        const x = ts.timeToCoordinate(m.nowTime as UTCTimestamp);
        if (x != null) {
          const left = Math.max(0, x + 3);
          if (left < plotW) mask = { left, width: plotW - left };
        }
      }
      const tags: Overlay["tags"] = [];
      for (const l of m.lines) {
        if (!l.label) continue;
        const y = a.bars.priceToCoordinate(l.price);
        if (y == null || y < 8 || y > plotH - 8) continue;
        tags.push({ id: l.id, y: Math.round(y), text: l.label, color: l.color });
      }
      let liq: Overlay["liq"] = null;
      const lq = m.lines.find((l) => l.id === "liq");
      if (lq) {
        const y0 = a.bars.priceToCoordinate(lq.price);
        let y: number = y0 ?? -1;
        if (y0 != null && y >= 8 && y <= plotH - 8) {
          // Position tag wins: if the entry tag (avg) or last-price tag overlaps, nudge liq by half a tag height (9px).
          const TAG = 18;
          const others = [m.lines.find((l) => l.id === "avg")?.price, lastLive(m)]
            .filter((v): v is number => v != null)
            .map((v) => a.bars.priceToCoordinate(v))
            .filter((v): v is NonNullable<typeof v> => v != null);
          for (const oy of others) {
            if (Math.abs(oy - y0) < TAG) y = y0 + (y0 <= oy ? -TAG / 2 : TAG / 2);
          }
          liq = { y: Math.round(y), left: plotW, width: a.chart.priceScale("right").width(), text: fmtNum(lq.price, m.blind) };
        }
      }
      const key = JSON.stringify([mask && Math.round(mask.left), mask && Math.round(mask.width), plotH, tags, liq]);
      if (key !== last) {
        last = key;
        setOverlay({ mask, tags, height: plotH, liq } as Overlay);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const [edgeNote, setEdgeNote] = useState<{ dir: "up" | "down"; label: string; color: string } | null>(null);
  const liqEdgeRef = useRef<{ price: number; label: string; color: string; lo: number; hi: number } | null>(null);
  const pickRef = useRef(onPick);
  const hoverRef = useRef(onHover);
  const hoverBarRef = useRef(onHoverBar);
  const baseRef = useRef(priceBase);
  const panesRef = useRef(onPanes);
  const plotsRef = useRef(plots);
  const selectRef = useRef(onSelect);
  const updateRef = useRef(onUpdateDrawing);
  const styleRef = useRef(onOpenStyle);
  const toolRef = useRef(tool);
  const drawingsRef = useRef(drawings);
  const selectedRef = useRef(selectedId);
  const dragRef = useRef<null | { id: number; handle: "a" | "b" | "c" }>(null);
  const suppressClickRef = useRef(false);
  useEffect(() => {
    pickRef.current = onPick;
    hoverRef.current = onHover;
    hoverBarRef.current = onHoverBar;
    baseRef.current = priceBase;
    panesRef.current = onPanes;
    plotsRef.current = plots;
    selectRef.current = onSelect;
    updateRef.current = onUpdateDrawing;
    styleRef.current = onOpenStyle;
    toolRef.current = tool;
    drawingsRef.current = drawings;
    selectedRef.current = selectedId;
  });

  // TradingView dark defaults: teal/red. greenUp=false swaps for China-style (red up / teal down).
  const up = greenUp ? "#37a74c" : "#cf4f5f";
  const down = greenUp ? "#cf4f5f" : "#37a74c";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const behavior = new RelDayBehavior();
    behaviorRef.current = behavior;
    behavior.t0 = modelRef.current?.t0 ?? null;
    const chart = createChartEx<Time, RelDayBehavior>(el, behavior, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#9598A1",
        fontFamily: '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: "#363A45", separatorHoverColor: "#2A2E39", enableResize: true },
      },
      grid: {
        vertLines: { color: "#1E222D" },
        horzLines: { color: "#1E222D" },
      },
      rightPriceScale: { borderColor: "#2A2E39", borderVisible: true, entireTextOnly: true, minimumWidth: 60 },
      timeScale: {
        borderColor: "#2A2E39",
        borderVisible: true,
        rightOffset: 12,
        barSpacing: 6,
        minBarSpacing: 3,
      },
      crosshair: {
        // Normal: price axis / horz line follow cursor Y (no OHLC magnet).
        // Vert line still snaps to nearest bar index — library limitation.
        mode: CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: "#5D606B",
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2A2E39",
        },
        horzLine: {
          width: 1,
          color: "#5D606B",
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2A2E39",
        },
      },
      // mouseWheel/pinch only call zoomTime (never price). Price-axis wheel is custom above.
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
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
      scaleMargins: { top: 0.08, bottom: 0.08 },
      mode: PriceScaleMode.Normal,
    });
    // Volume is a VOL sub-pane indicator (see indicators.ts), not glued under candles.
    const markers = createSeriesMarkers(bars, []);
    const draw = new DrawPrimitive();
    const now = new NowPrimitive();
    bars.attachPrimitive(draw);
    bars.attachPrimitive(now);
    const onClick = (param: MouseEventParams<Time>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (dragRef.current) return;
      if (toolRef.current === "cursor") {
        if (!param.point || param.paneIndex) {
          selectRef.current?.(null);
          return;
        }
        const hit = draw.pickAt(param.point.x, param.point.y);
        selectRef.current?.(hit ? hit.id : null);
        return;
      }
      const anchor = readAnchor(chart, bars, param, baseRef.current);
      if (anchor) pickRef.current(anchor);
    };
    const onDblClick = (param: MouseEventParams<Time>) => {
      if (toolRef.current !== "cursor" || !param.point || param.paneIndex) return;
      const hit = draw.pickAt(param.point.x, param.point.y);
      if (hit) {
        const shape = drawingsRef.current.find((d) => d.id === hit.id);
        if (shape?.kind === "channel") styleRef.current?.(shape.id);
      }
    };
    const onMove = (param: MouseEventParams<Time>) => {
      hoverRef.current(readAnchor(chart, bars, param, baseRef.current));
      // seriesData / param.time are nearest-bar (vert line snaps to index even in Normal).
      if (!param.point || typeof param.time !== "number") hoverBarRef.current?.(null);
      else hoverBarRef.current?.(param.time);
    };
    chart.subscribeClick(onClick);
    chart.subscribeDblClick(onDblClick);
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
    const mediaPoint = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    const onPointerDown = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const scaleW = Math.max(bars.priceScale().width(), 48);
      if (ev.clientX >= rect.right - scaleW) {
        priceDrag.current = true;
        return;
      }
      if (toolRef.current !== "cursor" || selectedRef.current == null) return;
      const pt = mediaPoint(ev);
      const hit = draw.pickAt(pt.x, pt.y);
      if (hit?.kind === "handle" && hit.id === selectedRef.current) {
        dragRef.current = { id: hit.id, handle: hit.handle };
        suppressClickRef.current = true;
        chart.applyOptions({ handleScroll: false, handleScale: false });
        ev.preventDefault();
      }
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (priceDrag.current) refreshLiqEdge();
      const drag = dragRef.current;
      if (!drag) return;
      const shape = drawingsRef.current.find((d) => d.id === drag.id);
      if (!shape || shape.kind !== "channel") return;
      const pt = mediaPoint(ev);
      const anchor = draw.anchorAt(pt.x, pt.y);
      if (!anchor) return;
      let next: Drawing = shape;
      if (drag.handle === "a") next = { ...shape, a: anchor };
      else if (drag.handle === "b") next = { ...shape, b: anchor };
      else next = { ...shape, c: anchor };
      // Keep local drawings ref in sync for smooth drag before React re-renders.
      drawingsRef.current = drawingsRef.current.map((d) => (d.id === next.id ? next : d));
      draw.sync(drawingsRef.current, null, baseRef.current, selectedRef.current);
      updateRef.current?.(next);
    };
    const onPointerUp = () => {
      if (priceDrag.current) requestAnimationFrame(refreshLiqEdge);
      priceDrag.current = false;
      if (dragRef.current) {
        dragRef.current = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
      }
    };
    // Wheel over right price axis → vertical zoom only (library wheel always zooms time).
    // Capture + stopImmediatePropagation so chart's _onMousewheel does not also zoom time.
    const onWheel = (ev: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const scaleW = Math.max(bars.priceScale().width(), 48);
      if (ev.clientX < rect.right - scaleW) return; // main/time area: library handleScale.mouseWheel → zoomTime only
      if (ev.deltaY === 0) return;
      if (ev.cancelable) ev.preventDefault();
      ev.stopImmediatePropagation();
      const y = ev.clientY - rect.top;
      const panes = chart.panes();
      let top = 0;
      let paneIndex = 0;
      for (let i = 0; i < panes.length; i++) {
        const h = panes[i].getHeight();
        if (y < top + h || i === panes.length - 1) {
          paneIndex = i;
          break;
        }
        top += h;
      }
      const scale = chart.priceScale("right", paneIndex);
      const range = scale.getVisibleRange();
      if (!range || !(range.to > range.from)) return;
      // Same spirit as library time zoom: small step, clamp magnitude.
      const step = Math.sign(-ev.deltaY) * Math.min(1, Math.abs(ev.deltaY) / 100);
      const factor = Math.exp(-step * 0.25); // <1 zoom in, >1 zoom out
      const span = range.to - range.from;
      let anchor: number;
      if (paneIndex === 0) {
        const localY = y; // main pane coords match series coordinateToPrice
        const px = bars.coordinateToPrice(localY);
        anchor = px != null ? Number(px) : (range.from + range.to) / 2;
      } else {
        const h = panes[paneIndex].getHeight() || 1;
        const t = Math.min(1, Math.max(0, (y - top) / h));
        anchor = range.to - t * span; // top of pane ≈ high price
      }
      const ratio = Math.min(1, Math.max(0, (anchor - range.from) / span));
      const newSpan = span * factor;
      scale.setVisibleRange({ from: anchor - newSpan * ratio, to: anchor + newSpan * (1 - ratio) });
      priceDrag.current = true; // treat as manual scale so live follow won't force autoScale
      requestAnimationFrame(refreshLiqEdge);
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    api.current = { chart, bars, markers, lines: [], draw, now, indSeries: [], indKey: "", paneKey: "" };
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
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
    const t0 = data.t0;
    // Weights for new time points are computed on setData below; keep them on relative-day boundaries.
    if (behaviorRef.current) behaviorRef.current.t0 = t0;
    a.chart.applyOptions({
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#2A2E39",
        // Revealed labels are "MM-DD HH:MM" (11 chars); reserve room so they don't collide.
        tickMarkMaxCharacterLength: data.blind ? undefined : 11,
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          data.blind && t0 != null ? fmtRelTick(time, type, t0) : data.blind ? "" : fmtAxis(time),
      },
      localization: {
        timeFormatter: (time: Time) => (data.blind && t0 != null ? fmtRelFull(time, t0) : data.blind ? "" : fmtAxis(time)),
      },
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
    api.current?.draw.sync(drawings, draft, priceBase, selectedId);
  }, [drawings, draft, priceBase, selectedId]);

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
            paneOf.set(p.pane, pane);
          } else pane = have;
        }
        const common = { priceLineVisible: false, lastValueVisible: p.style === "line" && p.pane !== "price" && !p.id.endsWith(":zero"), title: "" };
        const series: ISeriesApi<SeriesType, Time> =
          p.style === "hist"
            ? a.chart.addSeries(HistogramSeries, common, pane)
            : a.chart.addSeries(LineSeries, { ...common, color: p.color, lineWidth: 1, crosshairMarkerVisible: false }, pane);
        return { id: p.id, series };
      });
      a.indKey = key;
    }
    const modesNow = paneModesRef.current ?? {};
    for (const p of plots) {
      const handle = a.indSeries.find((item) => item.id === p.id);
      if (!handle) continue;
      const rows = p.points.map((pt) => ({ time: pt.time as UTCTimestamp, value: pt.value, color: pt.color }));
      handle.series.setData(rows);
      if (p.style === "line") {
        handle.series.applyOptions({
          color: p.color,
          lineWidth: p.width ?? 1,
          lineStyle: lineStyle[p.dash ?? "solid"],
          visible: p.visible !== false && modesNow[p.pane] !== "collapsed",
        });
      } else handle.series.applyOptions({ visible: p.visible !== false && modesNow[p.pane] !== "collapsed" });
    }
    // Sub-pane heights: only re-applied when panes were rebuilt or a mode changed, so user drags survive.
    const keys = paneOrder(plots);
    const modes = paneModesRef.current ?? {};
    const paneKey = a.indKey + "#" + keys.map((k) => `${k}:${modes[k] ?? ""}`).join(",");
    if (paneKey !== a.paneKey) {
      a.paneKey = paneKey;
      applyPaneHeights(a, plots, modes, ref.current);
    }
    const frame = requestAnimationFrame(() => {
      const live = api.current;
      if (live) panesRef.current(measurePanes(live.chart, plots));
    });
    return () => cancelAnimationFrame(frame);
  }, [plots, paneSig]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const watch = new ResizeObserver(() => {
      const live = api.current;
      if (live && paneModesRef.current && Object.values(paneModesRef.current).includes("max"))
        applyPaneHeights(live, plotsRef.current, paneModesRef.current, ref.current);
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
      {overlay.mask ? (
        <div
          className="unplayed-mask pointer-events-none absolute top-0 z-[2] bg-[#1E222D40]"
          style={{ left: overlay.mask.left, width: overlay.mask.width, height: overlay.height }}
        />
      ) : null}
      {overlay.liq ? (
        <span
          className="liq-axis-tag num pointer-events-none absolute z-[3] -translate-y-1/2 text-center text-[11px] leading-[18px] font-medium text-[#131722]"
          style={{ top: overlay.liq.y, left: overlay.liq.left, width: overlay.liq.width, background: "#F7A600" }}
        >
          {overlay.liq.text}
        </span>
      ) : null}
      {overlay.tags.map((tag) => (
        <span
          key={tag.id}
          className="line-tag num pointer-events-none absolute left-1.5 z-[3] -translate-y-1/2 rounded-[3px] px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap"
          style={{ top: tag.y, color: tag.color, background: `color-mix(in srgb, ${tag.color} 20%, #131722)`, border: `1px solid color-mix(in srgb, ${tag.color} 45%, transparent)` }}
        >
          {tag.text}
        </span>
      ))}
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
