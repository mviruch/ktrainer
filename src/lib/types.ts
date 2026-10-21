export type Side = 1 | -1;
export type MarginMode = "cross" | "isolated";
export type Interval = "5m" | "15m" | "1h" | "4h" | "1d";
export type Pool = "btc" | "btceth" | "top30" | "top100";
export type OrderTab = "market" | "limit";
export type Phase = "empty" | "loading" | "error" | "trade" | "result";

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export type Pos = {
  side: Side;
  qty: number;
  entry: number;
  lev: number;
  mode: MarginMode;
  margin: number;
  tp: number | null;
  sl: number | null;
  openIdx: number;
  /** PosStat id of this position (review capture). Missing on old saves. */
  pid?: number;
};

export type Order = {
  id: number;
  side: Side;
  price: number;
  qty: number;
  im: number;
  tp: number | null;
  sl: number | null;
  at: number;
  /** View interval when the order was placed (review capture). */
  view?: Interval;
  /** Snapshot taken when the order was placed; memory only (stripped from fut-round). */
  snap?: Snapshot | null;
};

export type Fill = {
  i: number;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  pnl: number;
  n: number;
  tag: string;
  type: string;
  /* ---- review capture (missing on old saves) ---- */
  /** Order id; market / TP / SL / liquidation / round-end fills get their own id from Round.oid. */
  oid?: number;
  /** Open time (ms) of bar i. */
  t?: number;
  /** View interval when the order behind this fill was placed; null for automatic fills (TP/SL/liq/round end). */
  view?: Interval | null;
  lev?: number;
  /** Position TP/SL in effect right after this fill (closing fills: before it). */
  tp?: number | null;
  sl?: number | null;
  /** Limit / trigger price that produced this fill; market = null. */
  orderPrice?: number | null;
  /** Set when this fill closes (part of) a position. */
  reason?: CloseReason | null;
  /** PosStat id touched (closed part, or opened/added). */
  posId?: number | null;
  /** Position opened by the opening part of this fill (reverse: the new one). */
  openPosId?: number | null;
  snap?: Snapshot | null;
};

export type CloseReason = "tp" | "sl" | "manual" | "round_end" | "liq";

export type EventKind = "place" | "cancel" | "trigger" | "tpsl";
export type EventSrc = "market" | "limit" | "tp" | "sl" | "liq" | "round_end" | "manual" | "order";

/** Order / TP-SL event stream (no price amend: product decision). Prices are real; export converts to 100-base. */
export type OrderEvent = {
  kind: EventKind;
  /** Bar index (same base as Fill.i) and its open time (ms). */
  i: number;
  t: number;
  oid: number | null;
  price: number | null;
  side: Side | null;
  src: EventSrc;
  tp?: number | null;
  sl?: number | null;
  why?: string;
  posId?: number | null;
};

/** One position from open to flat. A reverse closes this and opens a new one. Prices real. */
export type PosStat = {
  id: number;
  side: Side;
  openI: number;
  closeI: number | null;
  /** closeI - openI (bars held); null while open. */
  bars: number | null;
  /** First-open price / qty; later adds do not change R (product decision). */
  entry: number;
  qty0: number;
  /** SL attached to the opening order; null = no stop → every R field null. */
  sl0: number | null;
  /** |entry - sl0| per unit, and that times qty0 in U. */
  risk: number | null;
  riskU: number | null;
  /** Extremes seen while held (bars after the open bar, plus fill prices). */
  hi: number;
  lo: number;
  /** Most favourable / adverse price and the distance in R (both ≥ 0). */
  mfePx: number;
  maePx: number;
  mfeR: number | null;
  maeR: number | null;
  /** Gross realized pnl of all closing fills (fees excluded). */
  pnl: number;
  /** pnl / riskU. */
  rMult: number | null;
  adds: number;
  reason: CloseReason | null;
};

export type SnapBar = [t: number, o: number, h: number, l: number, c: number, vRel: number];

export type SnapFrame = {
  interval: Interval;
  want: number;
  got: number;
  /** Closed bars only; prices 100-base (base = close of bars[ctx-1]), volume / mean volume. null = unavailable. */
  bars: SnapBar[] | null;
  reason: string | null;
};

export type IndSnap = { id: number; kind: string; params: Record<string, number> };

export type Snapshot = {
  i: number;
  t: number;
  base: number | null;
  frames: SnapFrame[];
  inds: IndSnap[];
  /** Deep copy, real time / price (export converts). */
  drawings: Drawing[];
};

/** What the shell hands the core at order time. */
export type CaptureIn = { view?: Interval; inds?: { id: number; kind: string; params: Record<string, number> }[]; drawings?: Drawing[] };

export type Frame = { interval: Interval; bars: Bar[] };

export type Round = {
  symbol: string;
  interval: Interval;
  bars: Bar[];
  frames: Frame[];
  view: Interval;
  ctx: number;
  cursor: number;
  pos: Pos | null;
  orders: Order[];
  fills: Fill[];
  wallet: number;
  startWallet: number;
  fees: number;
  realized: number;
  peakEq: number;
  maxDD: number;
  oid: number;
  liqs: number;
  done: boolean;
  /** Set after settle once identity reveal succeeds; chart stays blind until then. */
  revealed?: boolean;
  peeked: boolean;
  bust: boolean;
  startedAt: number;
  extending?: boolean;
  drawings: Drawing[];
  /** Review capture: order event stream / per-position stats / drawings at round end. */
  events: OrderEvent[];
  posStats: PosStat[];
  endDrawings?: Drawing[] | null;
};

export type Anchor = { time: number; price: number };
export type DrawKind = "trend" | "ray" | "hline" | "fib" | "channel";
export type DrawLineStyle = "solid" | "dashed" | "dotted";

/** Style for drawings (channel panel). Candle up/down colors never remap these. */
export type DrawStyle = {
  color: string;
  width: 1 | 2 | 3;
  lineStyle: DrawLineStyle;
  fill: boolean;
  fillOpacity: number;
  fillColor?: string;
};

export const DEFAULT_CHANNEL_STYLE: DrawStyle = {
  color: "#2962FF",
  width: 2,
  lineStyle: "solid",
  fill: true,
  fillOpacity: 0.18,
};

export type Drawing =
  | { id: number; kind: "hline"; price: number; style?: DrawStyle }
  | { id: number; kind: "trend" | "ray" | "fib"; a: Anchor; b: Anchor; style?: DrawStyle }
  | { id: number; kind: "channel"; a: Anchor; b: Anchor; c: Anchor; style?: DrawStyle };

export type Config = {
  pool: Pool;
  intervals: string;
  greenUp: boolean;
};

export type Account = {
  wallet: number;
  lev: number;
  mode: MarginMode;
  busts: number;
  runN: number;
};

export type FillRec = {
  i: number;
  side: Side;
  tag: string;
  type: string;
  price: number;
  n: number;
  fee: number;
  pnl: number;
};

export type RoundLog = {
  ts: number;
  symbol: string;
  interval: string;
  startW: number;
  endW: number;
  pnl: number;
  fees: number;
  fills: number;
  liqs: number;
  maxDD: number;
  bars: number;
  reason: string;
  peeked: boolean;
  t0: number;
  t1: number;
  /** Round start time; used to settle each round at most once. */
  startedAt?: number;
  /** True only after identity reveal succeeded for this round. Missing (old saves) = not revealed. */
  revealed?: boolean;
  /** Blind price base (close of bars[ctx-1], same as the chart's 100). Missing on old saves. */
  base?: number;
  list: FillRec[];
};

export type RunLog = {
  idx: number;
  ts: number;
  n: number;
  pnl: number;
  fees: number;
  traded: number;
  wins: number;
  liqs: number;
  startW: number;
  endW: number;
  best: number;
  worst: number;
};

export type ActResult = { ok: true; info?: string } | { ok: false; error: string };

export type OrderDraft = {
  side: Side;
  tab: OrderTab;
  notional: number;
  limit: number | null;
  tp: number | null;
  sl: number | null;
  lev: number;
};

export type Drawn = {
  symbol: string;
  interval: Interval;
  bars: Bar[];
  frames?: Frame[];
  ctx: number;
};
