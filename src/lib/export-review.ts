/* 「复盘详细导出」. Pure TS: the shell reads fut-log / fut-review / IndexedDB snapshots and passes them in.
 *
 * 禁止输出真实数量（产品已定）：notional_u（U）与任何真实数量同时出现就能 ÷ 回真实成交价，盲测失效。
 * 数量只出 qty_100 = notional_u / fill_price_100（100 制单位量），它 × 100 制价只能得回 notional_u。
 * Fill.qty / PosStat.qty0 / 真实成交量一律不进输出，揭盲成功局也不补。
 *
 * Desensitisation: only revealed === true rounds get the real symbol (blind: "HIDDEN") / real_t0 / real_t1 / real{} sub-objects.
 * Every time is the blind D clock (fmtRelFull, zero = sessionZero = floor(t0 / 1000)); every price is 100-base
 * (price / RoundLog.base * 100) or null when base is missing.
 */
import { bjDate, fmtRelFull } from "./format.ts";
import type { ReviewFill, ReviewRec } from "./review-store.ts";
import type { SnapRec } from "./snap-store.ts";
import type { CloseReason, Drawing, OrderEvent, PosStat, RoundLog, Snapshot } from "./types.ts";

export const REVIEW_FORMAT = "ktrainer-review";
export const REVIEW_VERSION = 1;

type N = number | null;

export type ExpDrawing =
  | { id: number; kind: "hline"; price_100: N }
  | { id: number; kind: string; points: { d_time: string | null; price_100: N }[] };

export type ExpSnapshot = {
  /** Same axis as fill.bar_index: base bars since D0 (0 = opening bar); the last closed base bar at order time. */
  bar_index: number;
  d_time: string | null;
  frames: { interval: string; want: number; got: number; reason: string | null; bars: { d_time: string | null; o: N; h: N; l: N; c: N; vol_rel: number }[] | null }[];
  indicators: { kind: string; params: Record<string, number> }[];
  drawings: ExpDrawing[];
};

export type ExpBar = {
  bar_index: number;
  d_time: string | null;
  o: N;
  h: N;
  l: N;
  c: N;
  vol_rel: number;
  real?: { o: number; h: number; l: number; c: number };
};

export type ExpFill = {
  order_id: number | null;
  bar_index: number;
  d_time: string | null;
  view_interval: string | null;
  side: "long" | "short";
  open_close: "open" | "add" | "close" | "reverse";
  order_type: string;
  order_price_100: N;
  fill_price_100: N;
  notional_u: number;
  qty_100: N;
  leverage: N;
  tp_100: N;
  sl_100: N;
  fee: number;
  realized_pnl: number;
  close_reason: CloseReason | null;
  pos_id: number | null;
  open_pos_id: number | null;
  real?: { time: string | null; ts: number | null; fill_price: number; order_price: N; tp: N; sl: N };
  snapshot: ExpSnapshot | null;
  snapshot_reason: string | null;
};

export type ExpEvent = {
  kind: string;
  bar_index: number;
  d_time: string | null;
  order_id: number | null;
  price_100: N;
  tp_100: N;
  sl_100: N;
  /** trigger only (joined with the fill of the same order id); null for place / cancel / tpsl. */
  qty_100: N;
  notional_u: N;
  side: "long" | "short" | null;
  src: string;
  why: string | null;
  pos_id: number | null;
};

export type ExpPosition = {
  pos_id: number;
  side: "long" | "short";
  open_bar: number;
  close_bar: number | null;
  bars_held: number | null;
  entry_100: N;
  initial_sl_100: N;
  /** |entry - initial SL| in 100-base price units (a price distance, not an R multiple). */
  initial_risk_100: N;
  /** R denominator: initial risk × first fill qty (U). Adds never change it. */
  risk_u: N;
  /** Max over open + each add of |avg entry - SL in effect| × qty (U). Informational; not used as denominator. */
  risk_u_max: N;
  mfe_100: N;
  mae_100: N;
  mfe_r: N;
  mae_r: N;
  /** Bar (same axis as fill.bar_index) where the MFE / MAE was reached; null = no excursion. */
  mfe_bar: number | null;
  mae_bar: number | null;
  realized_pnl: number;
  fees: N;
  r_multiple: N;
  r_multiple_net: N;
  adds: number;
  close_reason: CloseReason | null;
};

export type ExpRound = {
  round_id: number;
  reveal_status: "revealed" | "blind";
  /** Real symbol only when revealed; blind rounds are the string "HIDDEN" (same as the CSVs). */
  symbol: string;
  real_t0?: string;
  real_t1?: string;
  d0: string;
  t1: string | null;
  base_interval: string;
  intervals: string[];
  /** Intervals base-aggregated because nothing was fetched (new listing / fetch failed); null = record predates the field. */
  aggregated_timeframes: string[] | null;
  total_bars: number;
  end_reason: string;
  pnl: number;
  fees: number;
  start_equity: number;
  end_equity: number;
  max_drawdown: number;
  fills_cut: number;
  snapshots_status: "ok" | "partial" | "missing";
  snapshots_reason: string | null;
  /** Base bars from D0 to round end (100-base, vol_rel; revealed rounds add real o/h/l/c). null + reason when missing. */
  round_bars: ExpBar[] | null;
  round_bars_reason: string | null;
  fills: ExpFill[];
  events: ExpEvent[];
  positions: ExpPosition[];
  end_drawings: ExpDrawing[];
};

export type ReviewExport = {
  format: string;
  version: number;
  time_format: string;
  price_format: string;
  rounds: ExpRound[];
};

export type SnapInput = {
  /** Snapshot record per startedAt (missing key = not in IndexedDB). */
  recs: Map<number, SnapRec>;
  /** Every startedAt still in IndexedDB; used to tell "pruned (>50)" from "not found". */
  keys: number[];
  /** Retention used by the shell (SNAP_KEEP). */
  keep: number;
};

const ORDER_TYPE: Record<string, string> = { 市价: "market", 限价: "limit", "限价·吃单": "limit_taker", 止盈: "tp", 止损: "sl", 强平: "liq" };
const sideOf = (s: number) => (s > 0 ? "long" : "short") as "long" | "short";
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const sig = (v: number) => +v.toPrecision(10);

function ctxOf(log: RoundLog) {
  const zero = Number.isFinite(log.t0) ? Math.floor(log.t0 / 1000) : null;
  const base = typeof log.base === "number" && log.base > 0 ? log.base : null;
  return {
    revealed: log.revealed === true,
    /** ms → D label */
    dms: (ms: number | null | undefined) => (zero != null && typeof ms === "number" && Number.isFinite(ms) ? fmtRelFull(Math.floor(ms / 1000), zero) || null : null),
    /** seconds (chart / drawing time) → D label */
    dsec: (s: number | null | undefined) => (zero != null && typeof s === "number" && Number.isFinite(s) ? fmtRelFull(Math.floor(s), zero) || null : null),
    p: (v: number | null | undefined): N => (base != null && typeof v === "number" && Number.isFinite(v) && v > 0 ? r6((v / base) * 100) : null),
    /** distance (not a level) → 100-base */
    d: (v: number | null | undefined): N => (base != null && typeof v === "number" && Number.isFinite(v) ? r6((v / base) * 100) : null),
    base,
  };
}
type Ctx = ReturnType<typeof ctxOf>;

function drawings(c: Ctx, rows: Drawing[] | null | undefined): ExpDrawing[] {
  return (rows ?? []).map((d) =>
    d.kind === "hline"
      ? { id: d.id, kind: "hline", price_100: c.p(d.price) }
      : { id: d.id, kind: d.kind, points: (d.kind === "channel" ? [d.a, d.b, d.c] : [d.a, d.b]).map((a) => ({ d_time: c.dsec(a.time), price_100: c.p(a.price) })) },
  );
}

/** Snapshot bars are stored 100-base already (same base); null them out when the round has no base. */
function snapshot(c: Ctx, s: Snapshot, off: number): ExpSnapshot {
  const ok = c.base != null;
  return {
    bar_index: s.i - off,
    d_time: c.dms(s.t),
    frames: s.frames.map((f) => ({
      interval: f.interval,
      want: f.want,
      got: f.got,
      reason: f.reason ?? (ok ? null : "缺 base"),
      bars: f.bars
        ? f.bars.map(([t, o, h, l, cl, v]) => ({ d_time: c.dms(t), o: ok ? o : null, h: ok ? h : null, l: ok ? l : null, c: ok ? cl : null, vol_rel: v }))
        : null,
    })),
    indicators: s.inds.map((i) => ({ kind: i.kind, params: { ...i.params } })),
    drawings: drawings(c, s.drawings),
  };
}

function openClose(f: ReviewFill): ExpFill["open_close"] {
  if (f.reason == null) return f.tag.startsWith("加") ? "add" : "open";
  return f.openPosId != null ? "reverse" : "close";
}

function fill(c: Ctx, f: ReviewFill, off: number, snap: Snapshot | undefined, snapMiss: string | null): ExpFill {
  const rel = f.i - off;
  const fp = c.p(f.price);
  const notional = +f.n.toFixed(2);
  const auto = f.reason != null && f.reason !== "manual" && f.view == null;
  const out: ExpFill = {
    order_id: f.oid ?? null,
    bar_index: rel,
    d_time: c.dms(f.t),
    view_interval: f.view ?? null,
    side: sideOf(f.side),
    open_close: openClose(f),
    order_type: ORDER_TYPE[f.type] ?? f.type,
    order_price_100: c.p(f.orderPrice),
    fill_price_100: fp,
    notional_u: notional,
    // 禁止输出真实数量（产品已定）：只给 100 制单位量。
    qty_100: fp ? sig(notional / fp) : null,
    leverage: f.lev ?? null,
    tp_100: c.p(f.tp),
    sl_100: c.p(f.sl),
    fee: +f.fee.toFixed(4),
    realized_pnl: +f.pnl.toFixed(4),
    close_reason: f.reason ?? null,
    pos_id: f.posId ?? null,
    open_pos_id: f.openPosId ?? null,
    snapshot: snap ? snapshot(c, snap, off) : null,
    snapshot_reason: snap ? null : auto ? "自动成交（止盈/止损/强平/局终），没有下单快照" : snapMiss ?? "未找到快照",
  };
  if (c.revealed) {
    out.real = { time: typeof f.t === "number" ? bjDate(f.t) : null, ts: f.t ?? null, fill_price: f.price, order_price: f.orderPrice ?? null, tp: f.tp ?? null, sl: f.sl ?? null };
  }
  return out;
}

function event(c: Ctx, e: OrderEvent, off: number, fills: Map<number, ExpFill>): ExpEvent {
  const f = e.kind === "trigger" && e.oid != null ? fills.get(e.oid) : undefined;
  return {
    kind: e.kind,
    bar_index: e.i - off,
    d_time: c.dms(e.t),
    order_id: e.oid,
    price_100: c.p(e.price),
    tp_100: c.p(e.tp),
    sl_100: c.p(e.sl),
    // 禁止输出真实数量（产品已定）：同成交一样只给 100 制单位量。
    qty_100: f ? f.qty_100 : null,
    notional_u: f ? f.notional_u : null,
    side: e.side == null ? null : sideOf(e.side),
    src: e.src,
    why: e.why ?? null,
    pos_id: e.posId ?? null,
  };
}

function position(c: Ctx, s: PosStat, off: number): ExpPosition {
  const hasR = s.risk != null && s.sl0 != null;
  return {
    pos_id: s.id,
    side: sideOf(s.side),
    open_bar: s.openI - off,
    close_bar: s.closeI == null ? null : s.closeI - off,
    bars_held: s.bars,
    entry_100: c.p(s.entry),
    initial_sl_100: c.p(s.sl0),
    initial_risk_100: hasR ? c.d(s.risk) : null,
    risk_u: hasR && s.riskU != null ? +s.riskU.toFixed(4) : null,
    risk_u_max: s.riskUMax != null ? +s.riskUMax.toFixed(4) : null,
    mfe_100: c.p(s.mfePx),
    mae_100: c.p(s.maePx),
    mfe_r: hasR ? s.mfeR : null,
    mae_r: hasR ? s.maeR : null,
    mfe_bar: s.mfeI == null ? null : s.mfeI - off,
    mae_bar: s.maeI == null ? null : s.maeI - off,
    realized_pnl: +s.pnl.toFixed(4),
    fees: s.fees != null ? +s.fees.toFixed(4) : null,
    r_multiple: hasR ? s.rMult : null,
    r_multiple_net: hasR && s.rMultNet != null ? s.rMultNet : null,
    adds: s.adds,
    close_reason: s.reason,
  };
}

/** Round bar k (0 = D0). Stored 100-base; revealed rounds add real prices (base × v / 100). Never real volume. */
function bar(c: Ctx, [t, o, h, l, cl, v]: [number, number, number, number, number, number], k: number): ExpBar {
  const ok = c.base != null;
  const out: ExpBar = { bar_index: k, d_time: c.dms(t), o: ok ? o : null, h: ok ? h : null, l: ok ? l : null, c: ok ? cl : null, vol_rel: v };
  if (c.revealed && c.base != null) {
    const real = (x: number) => +((x * c.base!) / 100).toPrecision(8);
    out.real = { o: real(o), h: real(h), l: real(l), c: real(cl) };
  }
  return out;
}

function missReason(startedAt: number, snaps: SnapInput) {
  const kept = [...snaps.keys].sort((a, b) => a - b);
  if (kept.length >= snaps.keep && startedAt < kept[0]) return `超出最近 ${snaps.keep} 局，快照已清理`;
  return "未找到快照";
}

export function exportRound(log: RoundLog, rv: ReviewRec, snaps: SnapInput): ExpRound {
  const c = ctxOf(log);
  const ivs = String(log.interval || "").split(",").filter(Boolean);
  // Fill.i / events / posStats are absolute bar indices; RoundLog.list[].i is relative (= f.i - ctx + 1).
  // Recover ctx-1 from the open time: t0 = bars[ctx-1].t and each fill carries its bar time.
  const off = offsetOf(log, rv);
  const rec = snaps.recs.get(rv.startedAt);
  const by = new Map((rec?.snaps ?? []).map((s) => [s.oid, s.snap]));
  const miss = rec ? null : missReason(rv.startedAt, snaps);
  const fills = rv.fills.map((f) => fill(c, f, off, f.oid != null ? by.get(f.oid) : undefined, miss));
  const fillByOid = new Map<number, ExpFill>();
  for (const f of fills) if (f.order_id != null && !fillByOid.has(f.order_id)) fillByOid.set(f.order_id, f);
  const rb = rec?.roundBars;
  const manual = fills.filter((f) => f.snapshot_reason == null || !f.snapshot_reason.startsWith("自动"));
  const got = manual.filter((f) => f.snapshot).length;
  const out: ExpRound = {
    round_id: rv.startedAt,
    reveal_status: c.revealed ? "revealed" : "blind",
    symbol: c.revealed ? log.symbol : "HIDDEN",
    d0: "D0 00:00",
    t1: c.dms(log.t1),
    base_interval: ivs[0] ?? "",
    intervals: ivs,
    aggregated_timeframes: Array.isArray(rv.aggregated) ? [...rv.aggregated] : null,
    total_bars: log.bars,
    end_reason: log.reason,
    pnl: log.pnl,
    fees: log.fees,
    start_equity: log.startW,
    end_equity: log.endW,
    max_drawdown: log.maxDD,
    fills_cut: rv.fillsCut ?? 0,
    snapshots_status: !manual.length || got === manual.length ? "ok" : got ? "partial" : "missing",
    snapshots_reason: miss,
    round_bars: rb ? rb.map((b, k) => bar(c, b, k)) : null,
    round_bars_reason: rb ? (c.base == null ? "缺 base" : null) : rec ? (rec.roundBars === null ? "缺 base" : "该局记录早于 round_bars") : miss,
    fills,
    events: rv.events.map((e) => event(c, e, off, fillByOid)),
    positions: rv.posStats.map((s) => position(c, s, off)),
    end_drawings: drawings(c, rv.endDrawings),
  };
  if (c.revealed) {
    out.real_t0 = bjDate(log.t0);
    out.real_t1 = bjDate(log.t1);
  }
  return out;
}

/** Absolute index of the opening bar (ctx - 1): from any fill with a bar time, else from the legacy list. */
function offsetOf(log: RoundLog, rv: ReviewRec) {
  if (typeof rv.ctx === "number" && rv.ctx > 0) return rv.ctx - 1;
  const ms = intervalMs(String(log.interval).split(",")[0]);
  for (const f of rv.fills) if (typeof f.t === "number" && ms) return f.i - Math.round((f.t - log.t0) / ms);
  for (const e of rv.events) if (ms) return e.i - Math.round((e.t - log.t0) / ms);
  const first = log.list?.[0];
  return first && rv.fills[0] ? rv.fills[0].i - first.i : 0;
}

function intervalMs(iv: string) {
  return ({ "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 } as Record<string, number>)[iv] ?? 0;
}

/** Only rounds that have a fut-review record (new rounds). */
export function buildReviewExport(logs: RoundLog[], reviews: ReviewRec[], snaps: SnapInput): ReviewExport {
  const byStart = new Map(reviews.map((r) => [r.startedAt, r]));
  const rounds: ExpRound[] = [];
  for (const log of logs) {
    const rv = log.startedAt != null ? byStart.get(log.startedAt) : undefined;
    if (rv) rounds.push(exportRound(log, rv, snaps));
  }
  return {
    format: REVIEW_FORMAT,
    version: REVIEW_VERSION,
    time_format: "D{day} HH:MM，相对开局那根（D0 00:00）的经过时间，不是真实钟点",
    price_format: "100 制：开局那根收盘 = 100；缺 base 的局为 null",
    rounds,
  };
}

export function reviewJson(x: ReviewExport) {
  return JSON.stringify(x, null, 2);
}

export const CSV_COLS = [
  "round_id", "reveal_status", "symbol", "order_id", "bar_index", "d_time", "view_interval", "side", "open_close", "order_type",
  "order_price_100", "fill_price_100", "notional_u", "qty_100", "leverage", "tp_100", "sl_100", "fee", "realized_pnl", "close_reason",
  "pos_id", "pos_side", "pos_bars_held", "pos_entry_100", "pos_initial_risk_100", "pos_risk_u", "pos_risk_u_max", "pos_mfe_r", "pos_mae_r", "pos_mfe_bar", "pos_mae_bar",
  "pos_r_multiple", "pos_r_multiple_net", "has_snapshot",
] as const;

/** Flat CSV, one row per fill (no snapshots, no real{}). */
export function reviewCsv(x: ReviewExport) {
  const q = (v: unknown) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines: string[] = [CSV_COLS.join(",")];
  for (const r of x.rounds) {
    const pos = new Map(r.positions.map((p) => [p.pos_id, p]));
    for (const f of r.fills) {
      const p = f.pos_id != null ? pos.get(f.pos_id) : undefined;
      const row: Record<(typeof CSV_COLS)[number], unknown> = {
        round_id: r.round_id, reveal_status: r.reveal_status, symbol: r.reveal_status === "revealed" ? r.symbol : "HIDDEN",
        order_id: f.order_id, bar_index: f.bar_index, d_time: f.d_time, view_interval: f.view_interval, side: f.side, open_close: f.open_close,
        order_type: f.order_type, order_price_100: f.order_price_100, fill_price_100: f.fill_price_100, notional_u: f.notional_u, qty_100: f.qty_100,
        leverage: f.leverage, tp_100: f.tp_100, sl_100: f.sl_100, fee: f.fee, realized_pnl: f.realized_pnl, close_reason: f.close_reason,
        pos_id: f.pos_id, pos_side: p?.side, pos_bars_held: p?.bars_held, pos_entry_100: p?.entry_100, pos_initial_risk_100: p?.initial_risk_100,
        pos_risk_u: p?.risk_u, pos_risk_u_max: p?.risk_u_max, pos_mfe_r: p?.mfe_r, pos_mae_r: p?.mae_r, pos_mfe_bar: p?.mfe_bar, pos_mae_bar: p?.mae_bar,
        pos_r_multiple: p?.r_multiple, pos_r_multiple_net: p?.r_multiple_net, has_snapshot: f.snapshot ? 1 : 0,
      };
      lines.push(CSV_COLS.map((k) => q(row[k])).join(","));
    }
  }
  return "\uFEFF" + lines.join("\n");
}

export const SUMMARY_COLS = [
  "round_id", "reveal_status", "symbol", "base_interval", "aggregated_timeframes", "total_bars", "end_reason", "fills", "fills_cut",
  "pnl", "fees", "start_equity", "end_equity", "max_drawdown",
  "positions", "positions_with_r", "r_sum", "r_avg", "r_net_sum", "r_net_avg", "r_best", "r_worst", "r_wins", "r_losses",
] as const;

/** Round-level summary CSV, one row per round. R stats only over positions that had an initial stop. */
export function reviewSummaryCsv(x: ReviewExport) {
  const q = (v: unknown) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const r6 = (v: number | null) => (v == null ? null : Math.round(v * 1e6) / 1e6);
  const lines: string[] = [SUMMARY_COLS.join(",")];
  for (const r of x.rounds) {
    const rs = r.positions.map((p) => p.r_multiple).filter((v): v is number => v != null);
    const rn = r.positions.map((p) => p.r_multiple_net).filter((v): v is number => v != null);
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    const row: Record<(typeof SUMMARY_COLS)[number], unknown> = {
      round_id: r.round_id, reveal_status: r.reveal_status, symbol: r.reveal_status === "revealed" ? r.symbol : "HIDDEN",
      base_interval: r.base_interval, aggregated_timeframes: r.aggregated_timeframes == null ? "NA" : r.aggregated_timeframes.join("|"), // [] → "", old record → NA
      total_bars: r.total_bars, end_reason: r.end_reason, fills: r.fills.length, fills_cut: r.fills_cut,
      pnl: r.pnl, fees: r.fees, start_equity: r.start_equity, end_equity: r.end_equity, max_drawdown: r.max_drawdown,
      positions: r.positions.length, positions_with_r: rs.length,
      r_sum: rs.length ? r6(sum(rs)) : null, r_avg: rs.length ? r6(sum(rs) / rs.length) : null,
      r_net_sum: rn.length ? r6(sum(rn)) : null, r_net_avg: rn.length ? r6(sum(rn) / rn.length) : null,
      r_best: rs.length ? r6(Math.max(...rs)) : null, r_worst: rs.length ? r6(Math.min(...rs)) : null,
      r_wins: rs.filter((v) => v > 0).length, r_losses: rs.filter((v) => v < 0).length,
    };
    lines.push(SUMMARY_COLS.map((k) => q(row[k])).join(","));
  }
  return "\uFEFF" + lines.join("\n");
}

export const REVIEW_FILES = { json: "review.json", fills: "review-fills.csv", rounds: "review-rounds.csv" } as const;

/** The three export files (packed into one zip by the shell). */
export function reviewFiles(x: ReviewExport) {
  return [
    { name: REVIEW_FILES.json, data: reviewJson(x) },
    { name: REVIEW_FILES.fills, data: reviewCsv(x) },
    { name: REVIEW_FILES.rounds, data: reviewSummaryCsv(x) },
  ];
}
