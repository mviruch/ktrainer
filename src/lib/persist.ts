import { FIXED, IV_OK, LEV_MAX, SPEED_MAX, SPEED_MIN } from "./constants";
import { store } from "./store";
import { defaultParams, defOf, styleOf, type IndInst, type IndKind, type IndStyle } from "./indicators";
import type { Account, Anchor, Bar, Config, Drawing, DrawStyle, Frame, Interval, OrderTab, Pool, Pos, Round, RoundLog, RunLog } from "./types";

function isPool(v: string): v is Pool {
  return v === "btc" || v === "btceth" || v === "top30" || v === "top100";
}

function isInterval(v: string): v is Interval {
  return (IV_OK as string[]).includes(v);
}

export function loadConfig(): Config {
  const saved = store.get<Partial<Config>>("fut-cfg", {});
  const cfg: Config = { pool: "top30", intervals: "5m,15m,1h,4h,1d", greenUp: true };
  if (saved.pool && isPool(saved.pool)) cfg.pool = saved.pool;
  const ivs = String(saved.intervals || "")
    .split(",")
    .filter(isInterval);
  if (ivs.length) cfg.intervals = ivs.join(",");
  if (typeof saved.greenUp === "boolean") cfg.greenUp = saved.greenUp;
  return cfg;
}

export function saveConfig(cfg: Config) {
  store.set("fut-cfg", { pool: cfg.pool, intervals: cfg.intervals, greenUp: cfg.greenUp });
}

export function loadAccount(): Account {
  const saved = store.get<Partial<Account>>("fut-acc", {});
  const acc: Account = {
    wallet: FIXED.account,
    lev: 5,
    mode: "cross",
    busts: 0,
    runN: 0,
    ...saved,
  };
  if (!(acc.wallet >= 0)) acc.wallet = FIXED.account;
  if (!(acc.lev >= 1 && acc.lev <= LEV_MAX)) acc.lev = 5;
  if (acc.mode !== "isolated") acc.mode = "cross";
  acc.busts = acc.busts || 0;
  acc.runN = acc.runN || 0;
  return acc;
}

export function saveAccount(acc: Account) {
  store.set("fut-acc", acc);
}

export function loadLog() {
  const v = store.get<RoundLog[]>("fut-log", []);
  return Array.isArray(v) ? v : [];
}

export function saveLog(rows: RoundLog[]) {
  store.set("fut-log", rows.length > 600 ? rows.slice(-600) : rows);
}

export function loadRuns() {
  const v = store.get<RunLog[]>("fut-runs", []);
  return Array.isArray(v) ? v : [];
}

export function saveRuns(rows: RunLog[]) {
  store.set("fut-runs", rows);
}

export function loadSpeed() {
  const v = Number(store.get("fut-speed", 3));
  return v >= SPEED_MIN && v <= SPEED_MAX ? v : 3;
}

export function loadTab(): OrderTab {
  return store.get<string>("fut-tab", "market") === "limit" ? "limit" : "market";
}

type SavedBar = [number, number, number, number, number, number];

function unpackBars(rows: SavedBar[]): Bar[] {
  return rows.map((k) => ({ t: k[0], o: k[1], h: k[2], l: k[3], c: k[4], v: k[5] }));
}

function unpackFrames(raw: unknown, base: Interval): Frame[] {
  if (!Array.isArray(raw)) return [];
  const out: Frame[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const iv = (item as { interval?: string }).interval;
    const rows = (item as { bars?: SavedBar[] }).bars;
    if (!iv || !isInterval(iv) || iv === base || !Array.isArray(rows) || !rows.length) continue;
    out.push({ interval: iv, bars: unpackBars(rows) });
  }
  return out;
}

function packBars(bars: Bar[]): SavedBar[] {
  return bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]);
}

export function saveRound(t: Round) {
  if (t.done) return;
  store.set("fut-round", {
    v: 1,
    symbol: t.symbol,
    interval: t.interval,
    view: t.view,
    frames: t.frames.map((f) => ({ interval: f.interval, bars: packBars(f.bars) })),
    ctx: t.ctx,
    cursor: t.cursor,
    bars: packBars(t.bars),
    pos: t.pos,
    orders: t.orders,
    fills: t.fills,
    wallet: t.wallet,
    startWallet: t.startWallet,
    fees: t.fees,
    realized: t.realized,
    peakEq: t.peakEq,
    maxDD: t.maxDD,
    oid: t.oid,
    liqs: t.liqs,
    peeked: t.peeked,
    startedAt: t.startedAt,
    drawings: t.drawings,
  });
}

export function clearRound() {
  store.del("fut-round");
}

export function loadRound(): Round | null {
  const r = store.get<{
    v?: number;
    symbol?: string;
    interval?: string;
    view?: string;
    frames?: unknown;
    ctx?: number;
    cursor?: number;
    bars?: SavedBar[];
    pos?: Pos | null;
    orders?: Round["orders"];
    fills?: Round["fills"];
    wallet?: number;
    startWallet?: number;
    fees?: number;
    realized?: number;
    peakEq?: number;
    maxDD?: number;
    oid?: number;
    liqs?: number;
    peeked?: boolean;
    startedAt?: number;
    drawings?: unknown;
  } | null>("fut-round", null);
  if (!r || r.v !== 1 || !Array.isArray(r.bars) || !(r.cursor && r.cursor > 0)) return null;
  if (!r.symbol || !r.interval || !isInterval(r.interval) || !r.ctx) return null;
  const bars = unpackBars(r.bars);
  if (r.cursor > bars.length || r.ctx > bars.length) return null;
  const frames = unpackFrames(r.frames, r.interval);
  const view = r.view && isInterval(r.view) && (r.view === r.interval || frames.some((f) => f.interval === r.view)) ? r.view : r.interval;
  return {
    symbol: r.symbol,
    interval: r.interval,
    bars,
    frames,
    view,
    ctx: r.ctx,
    cursor: r.cursor,
    pos: r.pos ?? null,
    orders: r.orders ?? [],
    fills: r.fills ?? [],
    wallet: r.wallet ?? FIXED.account,
    startWallet: r.startWallet ?? FIXED.account,
    fees: r.fees ?? 0,
    realized: r.realized ?? 0,
    peakEq: r.peakEq ?? r.wallet ?? FIXED.account,
    maxDD: r.maxDD ?? 0,
    oid: r.oid ?? 1,
    liqs: r.liqs ?? 0,
    done: false,
    peeked: !!r.peeked,
    bust: false,
    startedAt: r.startedAt ?? Date.now(),
    drawings: unpackDrawings(r.drawings),
  };
}

function anchorOk(v: unknown): v is Anchor {
  if (!v || typeof v !== "object") return false;
  const a = v as Anchor;
  return Number.isFinite(a.time) && Number.isFinite(a.price);
}

function styleOk(v: unknown): DrawStyle | undefined {
  if (!v || typeof v !== "object") return undefined;
  const s = v as DrawStyle;
  if (typeof s.color !== "string" || !s.color) return undefined;
  const width = s.width === 1 || s.width === 2 || s.width === 3 ? s.width : 2;
  const lineStyle = s.lineStyle === "dashed" || s.lineStyle === "dotted" ? s.lineStyle : "solid";
  const fill = s.fill !== false;
  let fillOpacity = Number(s.fillOpacity);
  if (!Number.isFinite(fillOpacity)) fillOpacity = 0.18;
  fillOpacity = Math.min(0.4, Math.max(0.05, fillOpacity));
  const fillColor = typeof s.fillColor === "string" && s.fillColor ? s.fillColor : undefined;
  return { color: s.color, width, lineStyle, fill, fillOpacity, fillColor };
}

function unpackDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const d = item as Drawing & { style?: unknown };
    const id = out.length + 1;
    const style = styleOk(d.style);
    if (d.kind === "hline" && Number.isFinite(d.price)) out.push({ id, kind: "hline", price: d.price, ...(style ? { style } : {}) });
    else if ((d.kind === "trend" || d.kind === "ray" || d.kind === "fib") && anchorOk(d.a) && anchorOk(d.b))
      out.push({ id, kind: d.kind, a: d.a, b: d.b, ...(style ? { style } : {}) });
    else if (d.kind === "channel" && anchorOk(d.a) && anchorOk(d.b) && anchorOk(d.c))
      out.push({ id, kind: "channel", a: d.a, b: d.b, c: d.c, ...(style ? { style } : {}) });
  }
  return out;
}

type SavedInd = {
  id?: number;
  kind?: string;
  on?: boolean;
  period?: number;
  fast?: number;
  slow?: number;
  signal?: number;
  params?: Record<string, number>;
  style?: IndStyle;
};

export function loadInds(): IndInst[] {
  const saved = store.get<SavedInd[]>("fut-ind", []);
  if (!Array.isArray(saved)) return [];
  const out: IndInst[] = [];
  let next = 1;
  for (const row of saved) {
    if (!row || typeof row !== "object" || !row.kind) continue;
    const def = defOf(row.kind);
    if (!def) continue;
    if (row.params && typeof row.id === "number" && row.on == null) {
      const params = defaultParams(def);
      for (const field of def.fields) {
        const value = row.params[field.key];
        if (Number.isFinite(value)) params[field.key] = value;
      }
      out.push({ id: row.id, kind: def.kind, params, style: styleOf({ id: row.id, kind: def.kind, style: row.style }) });
      next = Math.max(next, row.id + 1);
      continue;
    }
    if (!row.on) continue;
    const params = defaultParams(def);
    const old: [keyof SavedInd, string][] = [
      ["period", "period"],
      ["fast", "fast"],
      ["slow", "slow"],
      ["signal", "signal"],
    ];
    for (const [from, key] of old) {
      const value = row[from];
      if (typeof value === "number" && value > 0 && key in params) params[key] = Math.round(value);
    }
    const id = next++;
    out.push({ id, kind: def.kind as IndKind, params, style: styleOf({ id, kind: def.kind }) });
  }
  // Migrate always-on main-pane volume → VOL sub-pane (seed once; user removal sticks).
  if (!out.some((i) => i.kind === "VOL") && !store.get("fut-vol-seeded", false)) {
    const id = Math.max(next, out.reduce((m, i) => Math.max(m, i.id), 0) + 1);
    out.push({ id, kind: "VOL", params: {}, style: styleOf({ id, kind: "VOL" }) });
    store.set("fut-vol-seeded", true);
    store.set("fut-ind", out);
  }
  return out;
}

export function saveInds(rows: IndInst[]) {
  store.set("fut-ind", rows);
}

/** True when this in-progress / restored round was already written to the session log. */
export function findSettledRound(log: RoundLog[], t: Pick<Round, "startedAt" | "symbol" | "bars" | "ctx" | "cursor">): RoundLog | undefined {
  const byStart = log.find((r) => r.startedAt != null && r.startedAt === t.startedAt);
  if (byStart) return byStart;
  // Legacy rows (pre-startedAt): same symbol + candle window.
  const t0 = t.bars[t.ctx - 1]?.t;
  const t1 = t.bars[t.cursor - 1]?.t;
  if (t0 == null || t1 == null) return undefined;
  return log.find((r) => r.startedAt == null && r.symbol === t.symbol && r.t0 === t0 && r.t1 === t1);
}

export function toLog(t: Round, reason: string): RoundLog {
  const pnl = t.wallet - t.startWallet;
  return {
    ts: Date.now(),
    symbol: t.symbol,
    interval: [t.interval, ...t.frames.map((f) => f.interval)].join(","),
    startW: +t.startWallet.toFixed(2),
    endW: +t.wallet.toFixed(2),
    pnl: +pnl.toFixed(2),
    fees: +t.fees.toFixed(2),
    fills: t.fills.length,
    liqs: t.liqs,
    maxDD: +t.maxDD.toFixed(4),
    bars: t.cursor - t.ctx,
    reason,
    peeked: !!t.peeked,
    t0: t.bars[t.ctx - 1].t,
    t1: t.bars[t.cursor - 1].t,
    startedAt: t.startedAt,
    list: t.fills.slice(0, 80).map((f) => ({
      i: f.i - t.ctx + 1,
      side: f.side,
      tag: f.tag,
      type: f.type,
      price: +f.price.toPrecision(8),
      n: +f.n.toFixed(2),
      fee: +f.fee.toFixed(4),
      pnl: +f.pnl.toFixed(2),
    })),
  };
}
