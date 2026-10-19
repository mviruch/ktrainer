export type Side = 1 | -1;
export type MarginMode = "cross" | "isolated";
export type Interval = "15m" | "1h" | "4h" | "1d";
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
};

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
  peeked: boolean;
  bust: boolean;
  startedAt: number;
  extending?: boolean;
  drawings: Drawing[];
};

export type Anchor = { time: number; price: number };
export type DrawKind = "trend" | "ray" | "hline" | "fib";

export type Drawing =
  | { id: number; kind: "hline"; price: number }
  | { id: number; kind: Exclude<DrawKind, "hline">; a: Anchor; b: Anchor };

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
