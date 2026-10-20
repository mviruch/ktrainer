import wasmUrl from "talib-web/lib/talib.wasm?url";
import type { Bar } from "./types";

export type IndKind =
  | "SMA"
  | "EMA"
  | "WMA"
  | "BBANDS"
  | "SAR"
  | "RSI"
  | "MACD"
  | "STOCH"
  | "CCI"
  | "MOM"
  | "WILLR"
  | "ATR"
  | "OBV"
  | "MFI";

export type IndGroup = "trend" | "osc" | "volty" | "volume";

export type IndField = {
  key: string;
  label: string;
  def: number;
  min: number;
  max: number;
  step?: number;
};

export type IndDef = {
  kind: IndKind;
  name: string;
  en: string;
  group: IndGroup;
  where: "price" | "sub";
  alias: string;
  fields: IndField[];
};

export type LineDash = "solid" | "dashed" | "dotted";
export type LineCfg = { visible: boolean; color: string; width: 1 | 2 | 3; dash: LineDash };
export type IndStyle = {
  /** Legend eye: hide every series of this instance (legend row stays). */
  hidden: boolean;
  /** Sub-pane collapsed to its title bar. */
  collapsed: boolean;
  lines: Record<string, LineCfg>;
  histUp: string;
  histDown: string;
  /** 0–1, default 0.55 */
  histOpacity: number;
  /** 柱状图颜色跟随涨跌配色：红涨绿跌时对调 histUp / histDown */
  histFollow: boolean;
};

export type IndInst = {
  id: number;
  kind: IndKind;
  params: Record<string, number>;
  /** Optional for old saved rows; read through styleOf() which fills palette defaults. */
  style?: IndStyle;
};

export type PlotPoint = { time: number; value: number; color?: string };

export type Plot = {
  id: string;
  inst: number;
  pane: string;
  color: string;
  style: "line" | "hist";
  points: PlotPoint[];
  width?: 1 | 2 | 3;
  dash?: LineDash;
  visible?: boolean;
};

export type PaneBox = { pane: string; top: number };

export const IND_GROUPS: { id: IndGroup | "all"; name: string }[] = [
  { id: "all", name: "全部" },
  { id: "trend", name: "趋势" },
  { id: "osc", name: "震荡" },
  { id: "volty", name: "波动" },
  { id: "volume", name: "成交量" },
];

const f = (key: string, label: string, def: number, min: number, max: number, step?: number): IndField =>
  step == null ? { key, label, def, min, max } : { key, label, def, min, max, step };

export const IND_CATALOG: IndDef[] = [
  { kind: "SMA", name: "移动平均", en: "SMA", group: "trend", where: "price", alias: "ma 均线", fields: [f("period", "长度", 20, 2, 500)] },
  { kind: "EMA", name: "指数移动平均", en: "EMA", group: "trend", where: "price", alias: "均线", fields: [f("period", "长度", 60, 2, 500)] },
  { kind: "WMA", name: "加权移动平均", en: "WMA", group: "trend", where: "price", alias: "均线", fields: [f("period", "长度", 20, 2, 500)] },
  {
    kind: "BBANDS",
    name: "布林带",
    en: "BOLL",
    group: "trend",
    where: "price",
    alias: "bollinger 布林",
    fields: [f("period", "长度", 20, 2, 500), f("dev", "标准差", 2, 0.1, 5, 0.1)],
  },
  {
    kind: "SAR",
    name: "抛物线转向",
    en: "SAR",
    group: "trend",
    where: "price",
    alias: "抛物 停损",
    fields: [f("af", "加速", 0.02, 0.01, 0.2, 0.01), f("maxaf", "上限", 0.2, 0.02, 1, 0.01)],
  },
  { kind: "RSI", name: "相对强弱", en: "RSI", group: "osc", where: "sub", alias: "强弱", fields: [f("period", "长度", 14, 2, 200)] },
  {
    kind: "MACD",
    name: "平滑异同",
    en: "MACD",
    group: "osc",
    where: "sub",
    alias: "异同",
    fields: [f("fast", "快线", 12, 2, 200), f("slow", "慢线", 26, 3, 400), f("signal", "信号", 9, 1, 100)],
  },
  {
    kind: "STOCH",
    name: "随机指标",
    en: "KDJ",
    group: "osc",
    where: "sub",
    alias: "stoch kdj 随机",
    fields: [f("k", "K 周期", 9, 1, 200), f("smooth", "K 平滑", 3, 1, 50), f("d", "D 周期", 3, 1, 50)],
  },
  { kind: "CCI", name: "商品通道", en: "CCI", group: "osc", where: "sub", alias: "通道", fields: [f("period", "长度", 20, 2, 200)] },
  { kind: "MOM", name: "动量", en: "MOM", group: "osc", where: "sub", alias: "momentum", fields: [f("period", "长度", 10, 1, 200)] },
  { kind: "WILLR", name: "威廉指标", en: "W%R", group: "osc", where: "sub", alias: "williams 威廉", fields: [f("period", "长度", 14, 2, 200)] },
  { kind: "ATR", name: "平均真实波幅", en: "ATR", group: "volty", where: "sub", alias: "波幅", fields: [f("period", "长度", 14, 1, 200)] },
  { kind: "OBV", name: "能量潮", en: "OBV", group: "volume", where: "sub", alias: "能量", fields: [] },
  { kind: "MFI", name: "资金流量", en: "MFI", group: "volume", where: "sub", alias: "资金", fields: [f("period", "长度", 14, 2, 200)] },
];

const PALETTE = ["#2F6F9F", "#B7800F", "#7A5EA7", "#C46B4A", "#1E7A62", "#3E6B8A"];
export const IND_COLORS = PALETTE;
export const HIST_UP = "#1E9468";
export const HIST_DOWN = "#CC4444";
export const HIST_NEUTRAL = "#8A939D";

export function lineSlots(kind: IndKind): { key: string; label: string }[] {
  if (kind === "BBANDS") return [{ key: "up", label: "上轨" }, { key: "mid", label: "中轨" }, { key: "lo", label: "下轨" }];
  if (kind === "MACD") return [{ key: "line", label: "MACD" }, { key: "sig", label: "信号线" }, { key: "zero", label: "零轴" }];
  if (kind === "STOCH") return [{ key: "k", label: "K" }, { key: "d", label: "D" }];
  return [{ key: "line", label: "线" }];
}

export function hasHist(kind: IndKind) {
  return kind === "MACD";
}

/** Defaults reproduce the pre-style rendering exactly (palette colour by id, width 1, solid). */
export function defaultStyle(inst: Pick<IndInst, "id" | "kind">): IndStyle {
  const base = indColor(inst);
  const second = base === "#B7800F" ? "#2F6F9F" : "#B7800F";
  const lines: Record<string, LineCfg> = {};
  lineSlots(inst.kind).forEach((slot, i) => {
    lines[slot.key] =
      slot.key === "zero"
        ? { visible: true, color: HIST_NEUTRAL, width: 1, dash: "dashed" }
        : { visible: true, color: i === 1 && inst.kind !== "BBANDS" ? second : base, width: 1, dash: "solid" };
  });
  return { hidden: false, collapsed: false, lines, histUp: HIST_UP, histDown: HIST_DOWN, histOpacity: 0.55, histFollow: true };
}

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** Merge a (possibly partial / untrusted) saved style over palette defaults. */
export function styleOf(inst: Pick<IndInst, "id" | "kind" | "style">): IndStyle {
  const def = defaultStyle(inst);
  const raw = (inst.style ?? {}) as Partial<IndStyle>;
  const lines: Record<string, LineCfg> = {};
  for (const key of Object.keys(def.lines)) {
    const d = def.lines[key];
    const r = (raw.lines?.[key] ?? {}) as Partial<LineCfg>;
    lines[key] = {
      visible: typeof r.visible === "boolean" ? r.visible : d.visible,
      color: isHex(r.color) ? r.color : d.color,
      width: r.width === 1 || r.width === 2 || r.width === 3 ? r.width : d.width,
      dash: r.dash === "solid" || r.dash === "dashed" || r.dash === "dotted" ? r.dash : d.dash,
    };
  }
  return {
    hidden: typeof raw.hidden === "boolean" ? raw.hidden : def.hidden,
    collapsed: typeof raw.collapsed === "boolean" ? raw.collapsed : def.collapsed,
    lines,
    histUp: isHex(raw.histUp) ? raw.histUp : def.histUp,
    histDown: isHex(raw.histDown) ? raw.histDown : def.histDown,
    histOpacity: typeof raw.histOpacity === "number" && raw.histOpacity >= 0 && raw.histOpacity <= 1 ? raw.histOpacity : def.histOpacity,
    histFollow: typeof raw.histFollow === "boolean" ? raw.histFollow : def.histFollow,
  };
}

function alphaHex(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function defOf(kind: string) {
  return IND_CATALOG.find((d) => d.kind === kind);
}

export function defaultParams(def: IndDef) {
  const params: Record<string, number> = {};
  for (const field of def.fields) params[field.key] = field.def;
  return params;
}

function tuned(inst: IndInst): IndInst {
  const params = { ...inst.params };
  if (inst.kind === "MACD" && (params.slow ?? 0) <= (params.fast ?? 0)) params.slow = (params.fast ?? 12) + 1;
  if (inst.kind === "SAR" && (params.maxaf ?? 0) < (params.af ?? 0)) params.maxaf = params.af;
  return params === inst.params ? inst : { ...inst, params };
}

export function indTitle(inst: IndInst) {
  const use = tuned(inst);
  const def = defOf(use.kind);
  if (!def) return use.kind;
  const bits = def.fields.map((field) => fmtN(readParam(use, field)));
  return bits.length ? `${def.en} ${bits.join(",")}` : def.en;
}

export function indColor(inst: Pick<IndInst, "id" | "kind">) {
  if (inst.kind === "BBANDS") return "#8A939D";
  return PALETTE[Math.abs(inst.id) % PALETTE.length];
}

export function instPane(inst: IndInst) {
  const def = defOf(inst.kind);
  return !def || def.where === "price" ? "price" : `s${inst.id}`;
}

export function paneOrder(plots: Plot[]) {
  const keys = ["price"];
  for (const plot of plots) if (!keys.includes(plot.pane)) keys.push(plot.pane);
  return keys;
}

function fmtN(n: number) {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

function readParam(inst: IndInst, field: IndField) {
  const raw = inst.params[field.key];
  const n = Number.isFinite(raw) ? raw : field.def;
  const v = field.step == null ? Math.round(n) : Math.round(n / field.step) * field.step;
  return Math.min(field.max, Math.max(field.min, v));
}

function param(inst: IndInst, key: string) {
  const field = defOf(inst.kind)?.fields.find((item) => item.key === key);
  if (!field) return 0;
  return readParam(inst, field);
}

type Mod = {
  ccall: (ident: string, returnType: string, argTypes: string[], args: number[]) => number;
  _malloc: (n: number) => number;
  _free: (p: number) => void;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
};

let ready: Promise<Mod> | null = null;

function talib() {
  ready ??= import("talib-web").then(async (m) => (await m.init(wasmUrl)) as Mod);
  return ready;
}

/* 官方包装在 free 之后才拷结果，末尾会被写坏，而且丢掉了 outBegIdx。
   这里直接 ccall，先读出有效段再释放。 */
function runTA(mod: Mod, name: string, inputs: number[][], optTypes: string[], opts: number[], nOut: number) {
  const n = inputs[0]?.length ?? 0;
  const empty = { beg: 0, cols: Array.from({ length: nOut }, () => [] as number[]) };
  if (n < 2) return empty;
  const ptrs: number[] = [];
  const take = (bytes: number) => {
    const p = mod._malloc(bytes);
    ptrs.push(p);
    return p;
  };
  const inP = inputs.map(() => take(n * 8));
  const outP = Array.from({ length: nOut }, () => take(n * 8));
  const begP = take(4);
  const nbP = take(4);
  for (let i = 0; i < inputs.length; i++) mod.HEAPF64.set(inputs[i], inP[i] / 8);
  for (const p of outP) mod.HEAPF64.fill(0, p / 8, p / 8 + n);
  const args = [0, n - 1, ...inP, ...opts, begP, nbP, ...outP];
  const types = ["number", "number", ...inP.map(() => "number"), ...optTypes, "number", "number", ...outP.map(() => "number")];
  try {
    const rc = mod.ccall(name, "number", types, args);
    if (rc !== 0) throw new Error(`${name} ${rc}`);
    const beg = mod.HEAP32[begP >> 2];
    const nb = mod.HEAP32[nbP >> 2];
    const cols = outP.map((p) => Array.from(mod.HEAPF64.subarray(p / 8, p / 8 + nb)));
    return { beg, cols };
  } finally {
    for (const p of ptrs) mod._free(p);
  }
}

function shown(v: number, base: number | null) {
  return base ? (v / base) * 100 : v;
}

function placed(bars: Bar[], values: ArrayLike<number>, lookback: number, map: (v: number) => number): PlotPoint[] {
  const count = Math.min(values.length, bars.length - lookback);
  const out: PlotPoint[] = [];
  for (let i = 0; i < count; i++) {
    const value = map(Number(values[i]));
    if (!Number.isFinite(value)) continue;
    out.push({ time: Math.floor(bars[lookback + i].t / 1000), value });
  }
  return out;
}

function plotOf(inst: IndInst, slot: string, pane: string, color: string, style: "line" | "hist", bars: Bar[], values: ArrayLike<number>, beg: number, map: (v: number) => number): Plot {
  return { id: `${inst.id}:${slot}`, inst: inst.id, pane, color, style, points: placed(bars, values, beg, map) };
}

function relVolume(bars: Bar[], base: number | null) {
  if (!base) return bars.map((b) => b.v);
  let sum = 0;
  for (const bar of bars) sum += bar.v;
  const avg = sum / bars.length || 1;
  return bars.map((b) => b.v / avg);
}

export async function computeIndicators(bars: Bar[], insts: IndInst[], base: number | null, greenUp = true): Promise<Plot[]> {
  if (!bars.length || !insts.length) return [];
  const mod = await talib();
  const close = bars.map((b) => b.c);
  const high = bars.map((b) => b.h);
  const low = bars.map((b) => b.l);
  const plots: Plot[] = [];
  for (const inst of insts) {
    const def = defOf(inst.kind);
    if (!def) continue;
    const pane = instPane(inst);
    const color = indColor(inst);
    const price = (v: number) => shown(v, base);
    const st = styleOf(inst);
    const swap = st.histFollow && !greenUp;
    const hUp = swap ? st.histDown : st.histUp;
    const hDown = swap ? st.histUp : st.histDown;
    const histColor = (v: number) => alphaHex(v >= 0 ? hUp : hDown, st.histOpacity);
    const from = plots.length;
    try {
      if (inst.kind === "SMA" || inst.kind === "EMA" || inst.kind === "WMA") {
        const fn = inst.kind === "SMA" ? "TA_SMA" : inst.kind === "EMA" ? "TA_EMA" : "TA_WMA";
        const out = runTA(mod, fn, [close], ["number"], [param(inst, "period")], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, price));
      } else if (inst.kind === "BBANDS") {
        const dev = param(inst, "dev");
        const band = runTA(mod, "TA_BBANDS", [close], ["number", "double", "double", "number"], [param(inst, "period"), dev, dev, 0], 3);
        plots.push(
          plotOf(inst, "up", pane, color, "line", bars, band.cols[0], band.beg, price),
          plotOf(inst, "mid", pane, color, "line", bars, band.cols[1], band.beg, price),
          plotOf(inst, "lo", pane, color, "line", bars, band.cols[2], band.beg, price),
        );
      } else if (inst.kind === "SAR") {
        const af = param(inst, "af");
        let maxaf = param(inst, "maxaf");
        if (maxaf < af) maxaf = af;
        const out = runTA(mod, "TA_SAR", [high, low], ["double", "double"], [af, maxaf], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, price));
      } else if (inst.kind === "RSI") {
        const out = runTA(mod, "TA_RSI", [close], ["number"], [param(inst, "period")], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, (v) => v));
      } else if (inst.kind === "MACD") {
        const fast = param(inst, "fast");
        let slow = param(inst, "slow");
        if (slow <= fast) slow = fast + 1;
        const macd = runTA(mod, "TA_MACD", [close], ["number", "number", "number"], [fast, slow, param(inst, "signal")], 3);
        const hist = placed(bars, macd.cols[2], macd.beg, price).map((pt) => ({
          ...pt,
          color: histColor(pt.value),
        }));
        plots.push(
          { id: `${inst.id}:hist`, inst: inst.id, pane, color: "#8A939D", style: "hist", points: hist },
          plotOf(inst, "line", pane, color, "line", bars, macd.cols[0], macd.beg, price),
          plotOf(inst, "sig", pane, color === "#B7800F" ? "#2F6F9F" : "#B7800F", "line", bars, macd.cols[1], macd.beg, price),
          { id: `${inst.id}:zero`, inst: inst.id, pane, color: HIST_NEUTRAL, style: "line", points: hist.map((pt) => ({ time: pt.time, value: 0 })) },
        );
      } else if (inst.kind === "STOCH") {
        const out = runTA(mod, "TA_STOCH", [high, low, close], ["number", "number", "number", "number", "number"], [param(inst, "k"), param(inst, "smooth"), 0, param(inst, "d"), 0], 2);
        plots.push(
          plotOf(inst, "k", pane, color, "line", bars, out.cols[0], out.beg, (v) => v),
          plotOf(inst, "d", pane, color === "#B7800F" ? "#2F6F9F" : "#B7800F", "line", bars, out.cols[1], out.beg, (v) => v),
        );
      } else if (inst.kind === "CCI") {
        const out = runTA(mod, "TA_CCI", [high, low, close], ["number"], [param(inst, "period")], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, (v) => v));
      } else if (inst.kind === "MOM") {
        const out = runTA(mod, "TA_MOM", [close], ["number"], [param(inst, "period")], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, price));
      } else if (inst.kind === "WILLR") {
        const out = runTA(mod, "TA_WILLR", [high, low, close], ["number"], [param(inst, "period")], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, (v) => v));
      } else if (inst.kind === "ATR") {
        const out = runTA(mod, "TA_ATR", [high, low, close], ["number"], [param(inst, "period")], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, price));
      } else if (inst.kind === "OBV") {
        const out = runTA(mod, "TA_OBV", [close, relVolume(bars, base)], [], [], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, (v) => v));
      } else if (inst.kind === "MFI") {
        const out = runTA(mod, "TA_MFI", [high, low, close, bars.map((b) => b.v)], ["number"], [param(inst, "period")], 1);
        plots.push(plotOf(inst, "line", pane, color, "line", bars, out.cols[0], out.beg, (v) => v));
      }
    } catch {
      /* 这一条的参数算不出来就跳过，别把别的指标一起清掉。 */
    }
    for (let i = from; i < plots.length; i++) {
      const plot = plots[i];
      const slot = plot.id.slice(String(inst.id).length + 1);
      const cfg = st.lines[slot];
      if (cfg) {
        plot.color = cfg.color;
        plot.width = cfg.width;
        plot.dash = cfg.dash;
      }
      plot.visible = !st.hidden && !st.collapsed && (cfg ? cfg.visible : true);
    }
  }
  return plots;
}
