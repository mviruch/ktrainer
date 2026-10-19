import { FEE_MAKER, FEE_TAKER, MMR } from "./constants";
import type { ActResult, Bar, Drawn, Order, OrderDraft, Pos, Round, Side } from "./types";

const slipOf = (sym: string) => (sym === "BTCUSDT" || sym === "ETHUSDT" ? 0.0001 : 0.0003);

export function opp(side: Side): Side {
  return side === 1 ? -1 : 1;
}

export function priceNow(t: Round) {
  return t.bars[t.cursor - 1].c;
}

export function slipPx(t: Round, side: Side, p: number) {
  return p * (1 + side * slipOf(t.symbol));
}

export function uPnl(t: Round, p: number) {
  return t.pos ? t.pos.side * t.pos.qty * (p - t.pos.entry) : 0;
}

export function posIM(t: Round, p: number) {
  const P = t.pos;
  if (!P) return 0;
  return P.mode === "isolated" ? P.margin : (P.qty * p) / P.lev;
}

export function ordersIM(t: Round) {
  return t.orders.reduce((a, o) => a + (o.im || 0), 0);
}

export function equityAt(t: Round, p: number) {
  return t.wallet + uPnl(t, p);
}

export function availBal(t: Round, p?: number) {
  const px = p == null ? priceNow(t) : p;
  const P = t.pos;
  const v =
    !P || P.mode === "cross"
      ? t.wallet + uPnl(t, px) - posIM(t, px) - ordersIM(t)
      : t.wallet - P.margin - ordersIM(t);
  return Math.max(0, v);
}

export function liqPrice(t: Round) {
  const P = t.pos;
  if (!P) return null;
  const M = P.mode === "isolated" ? P.margin : t.wallet;
  const q = P.qty;
  const e = P.entry;
  const lp = P.side > 0 ? (q * e - M) / (q * (1 - MMR)) : (M + q * e) / (q * (1 + MMR));
  return lp > 0 && Number.isFinite(lp) ? lp : null;
}

function closableQty(t: Round, side: Side, exceptId?: number | "now") {
  const P = t.pos;
  if (!P || P.side === side) return 0;
  const pend = t.orders
    .filter((o) => o.side === side && o.id !== exceptId)
    .reduce((a, o) => a + o.qty, 0);
  return Math.max(0, P.qty - pend);
}

function needMargin(
  t: Round,
  lev: number,
  side: Side,
  qty: number,
  price: number,
  feeRate: number,
  exceptId?: number | "now",
) {
  const closeBase = t.pos && t.pos.side !== side ? (exceptId === "now" ? t.pos.qty : closableQty(t, side, exceptId)) : 0;
  const closeQ = Math.min(qty, closeBase);
  return { closeQ, im: ((qty - closeQ) * price) / lev, fee: qty * price * feeRate };
}

export function maxOpen(t: Round, side: Side, lev: number) {
  const p = priceNow(t);
  let n = availBal(t, p) / (1 / lev + FEE_TAKER);
  if (t.pos && t.pos.side !== side) n += t.pos.qty * p + posIM(t, p) / (1 / lev + FEE_TAKER);
  return Math.max(0, n);
}

function openPos(t: Round, side: Side, qty: number, price: number, lev: number, mode: Pos["mode"], idx: number, closeQ: number) {
  t.pos = {
    side,
    qty,
    entry: price,
    lev,
    mode,
    margin: mode === "isolated" ? (qty * price) / lev : 0,
    tp: null,
    sl: null,
    openIdx: idx,
  };
  return closeQ > 0 ? "反手开" + (side > 0 ? "多" : "空") : "开" + (side > 0 ? "多" : "空");
}

function applyFill(
  t: Round,
  side: Side,
  qty: number,
  price: number,
  feeRate: number,
  idx: number,
  type: string,
  lev: number,
  mode: Pos["mode"],
  why?: string,
) {
  if (!(qty > 0) || !(price > 0)) return;
  const P = t.pos;
  let closeQ = 0;
  let realized = 0;
  if (P && P.side !== side) {
    closeQ = Math.min(qty, P.qty);
    realized = P.side * closeQ * (price - P.entry);
    if (P.mode === "isolated") P.margin -= (P.margin * closeQ) / P.qty;
    P.qty -= closeQ;
    if (P.qty * price < 1e-6) t.pos = null;
  }
  const openQ = qty - closeQ;
  const L = side > 0 ? "多" : "空";
  const oppL = side > 0 ? "空" : "多";
  let tag: string;
  if (openQ > 1e-12) {
    if (t.pos) {
      const Q = t.pos.qty + openQ;
      t.pos.entry = (t.pos.entry * t.pos.qty + price * openQ) / Q;
      t.pos.qty = Q;
      if (t.pos.mode === "isolated") t.pos.margin += (openQ * price) / t.pos.lev;
      tag = "加" + L;
    } else tag = openPos(t, side, openQ, price, lev, mode, idx, closeQ);
  } else tag = "平" + oppL;
  const fee = qty * price * feeRate;
  t.wallet += realized - fee;
  t.fees += fee;
  t.realized += realized;
  t.fills.push({
    i: idx,
    side,
    qty,
    price,
    fee,
    pnl: realized,
    n: qty * price,
    tag: why ? why + (closeQ > 0 ? "·平" + oppL : "") : tag,
    type,
  });
}

function fillOrder(t: Round, o: Order, price: number, idx: number, lev: number, mode: Pos["mode"], msgs: string[]) {
  t.orders = t.orders.filter((x) => x !== o);
  const nm = needMargin(t, lev, o.side, o.qty, price, FEE_MAKER, o.id);
  if (nm.im + nm.fee > availBal(t) + 1e-6) {
    msgs.push("保证金不足，一笔限价单成交不了，已撤销");
    return;
  }
  applyFill(t, o.side, o.qty, price, FEE_MAKER, idx, "限价", lev, mode);
  if (t.pos && t.pos.side === o.side) {
    if (o.tp) t.pos.tp = o.tp;
    if (o.sl) t.pos.sl = o.sl;
  }
}

function liquidate(t: Round, at: number, idx: number, msgs: string[]) {
  const P = t.pos;
  if (!P) return;
  const q = P.qty;
  const raw = P.side * q * (at - P.entry);
  const fee = q * at * MMR;
  let delta = raw - fee;
  if (P.mode === "isolated") delta = Math.max(delta, -P.margin);
  const before = t.wallet;
  t.wallet = Math.max(0, t.wallet + delta);
  const paidFee = Math.max(0, Math.min(fee, raw - (t.wallet - before)));
  t.realized += raw;
  t.fees += paidFee;
  t.fills.push({
    i: idx,
    side: opp(P.side),
    qty: q,
    price: at,
    fee: paidFee,
    pnl: raw,
    n: q * at,
    tag: "强平·平" + (P.side > 0 ? "多" : "空"),
    type: "强平",
  });
  t.pos = null;
  t.orders = [];
  t.liqs++;
  if (t.wallet < 1) t.bust = true;
  msgs.push(t.bust ? "爆仓：账户归零" : "仓位被强平");
}

type Ev = { t: number; kind: "order" | "liq" | "sl" | "tp"; o?: Order; pri: number };

function pendingEvents(t: Round): Ev[] {
  const ev: Ev[] = [];
  for (const o of t.orders) ev.push({ t: o.price, kind: "order", o, pri: 3 });
  const P = t.pos;
  if (P) {
    const lq = liqPrice(t);
    if (lq) ev.push({ t: lq, kind: "liq", pri: 0 });
    if (P.sl) ev.push({ t: P.sl, kind: "sl", pri: 1 });
    if (P.tp) ev.push({ t: P.tp, kind: "tp", pri: 2 });
  }
  return ev;
}

function runSeg(
  t: Round,
  lev: number,
  mode: Pos["mode"],
  a: number,
  b: number,
  idx: number,
  gap: boolean,
  msgs: string[],
) {
  if (a === b) return;
  let cur = a;
  for (let g = 0; g < 60 && !t.done; g++) {
    const lo = Math.min(cur, b);
    const hi = Math.max(cur, b);
    const eps = hi * 1e-12;
    let best: (Ev & { d: number }) | null = null;
    for (const e of pendingEvents(t)) {
      if (e.t < lo - eps || e.t > hi + eps) continue;
      const d = Math.abs(e.t - cur);
      if (!best || d < best.d - eps || (Math.abs(d - best.d) <= eps && e.pri < best.pri)) best = { ...e, d };
    }
    if (!best) return;
    const at = gap ? b : best.t;
    if (best.kind === "order" && best.o) {
      const o = best.o;
      const px = gap ? (o.side > 0 ? Math.min(o.price, at) : Math.max(o.price, at)) : o.price;
      fillOrder(t, o, px, idx, lev, mode, msgs);
    } else if (best.kind === "liq") {
      liquidate(t, at, idx, msgs);
    } else if (t.pos) {
      const P = t.pos;
      const side = opp(P.side);
      applyFill(
        t,
        side,
        P.qty,
        slipPx(t, side, at),
        FEE_TAKER,
        idx,
        best.kind === "tp" ? "止盈" : "止损",
        lev,
        mode,
        best.kind === "tp" ? "止盈" : "止损",
      );
    }
    cur = best.t;
  }
}

export function processBar(t: Round, lev: number, mode: Pos["mode"], k: Bar, prevC: number, idx: number, msgs: string[]) {
  const path = k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c];
  runSeg(t, lev, mode, prevC, k.o, idx, true, msgs);
  for (let j = 0; j < 3; j++) runSeg(t, lev, mode, path[j], path[j + 1], idx, false, msgs);
}

export function advance(t: Round, lev: number, mode: Pos["mode"]) {
  if (t.cursor >= t.bars.length) return { needMore: true, toasts: [] as string[] };
  const k = t.bars[t.cursor];
  const prevC = t.bars[t.cursor - 1].c;
  t.cursor++;
  const toasts: string[] = [];
  processBar(t, lev, mode, k, prevC, t.cursor - 1, toasts);
  const eq = equityAt(t, k.c);
  if (eq > t.peakEq) t.peakEq = eq;
  if (t.peakEq > 0) t.maxDD = Math.max(t.maxDD, (t.peakEq - eq) / t.peakEq);
  return { needMore: false, toasts };
}

export function placeOrder(t: Round, d: OrderDraft, mode: Pos["mode"]): ActResult {
  if (t.done) return { ok: false, error: "这一局已经结束" };
  if (!(d.notional > 0)) return { ok: false, error: "先填数量（USDT）" };
  const p = priceNow(t);
  let price = p;
  if (d.tab === "limit") {
    if (!(d.limit && d.limit > 0)) return { ok: false, error: "限价单要填价格" };
    price = d.limit;
  }
  const ref = d.tab === "limit" ? price : p;
  if (d.tp != null) {
    if (!(d.tp > 0)) return { ok: false, error: "止盈价格不对" };
    if (d.side > 0 ? d.tp <= ref : d.tp >= ref)
      return { ok: false, error: d.side > 0 ? "做多的止盈要高于进场价" : "做空的止盈要低于进场价" };
  }
  if (d.sl != null) {
    if (!(d.sl > 0)) return { ok: false, error: "止损价格不对" };
    if (d.side > 0 ? d.sl >= ref : d.sl <= ref)
      return { ok: false, error: d.side > 0 ? "做多的止损要低于进场价" : "做空的止损要高于进场价" };
  }
  const idx = t.cursor - 1;
  const marketable = d.tab === "market" || (d.side > 0 ? price >= p : price <= p);
  if (marketable) {
    const fill =
      d.tab === "market"
        ? slipPx(t, d.side, p)
        : d.side > 0
          ? Math.min(price, slipPx(t, d.side, p))
          : Math.max(price, slipPx(t, d.side, p));
    const qty = d.notional / fill;
    const nm = needMargin(t, d.lev, d.side, qty, fill, FEE_TAKER, "now");
    const closeIM = t.pos && nm.closeQ > 0 ? (posIM(t, p) * nm.closeQ) / t.pos.qty : 0;
    if (nm.im + nm.fee > availBal(t, p) + closeIM + 1e-6)
      return { ok: false, error: "可用保证金不足，减少数量或加杠杆" };
    applyFill(t, d.side, qty, fill, FEE_TAKER, idx, d.tab === "market" ? "市价" : "限价·吃单", d.lev, mode);
    if (t.pos && t.pos.side === d.side) {
      if (d.tp) t.pos.tp = d.tp;
      if (d.sl) t.pos.sl = d.sl;
    }
    return d.tab === "limit"
      ? { ok: true, info: "限价单价格已经穿过最新价，直接按市价成交（收吃单手续费）" }
      : { ok: true };
  }
  const qty = d.notional / price;
  const nm = needMargin(t, d.lev, d.side, qty, price, FEE_MAKER);
  if (nm.im + nm.fee > availBal(t, p) + 1e-6) return { ok: false, error: "可用保证金不足，减少数量或加杠杆" };
  t.orders.push({
    id: t.oid++,
    side: d.side,
    price,
    qty,
    im: nm.im + nm.fee,
    tp: d.tp,
    sl: d.sl,
    at: idx,
  });
  return { ok: true, info: `已挂${d.side > 0 ? "买" : "卖"}单` };
}

export function closePct(t: Round, f: number, lev: number, mode: Pos["mode"]) {
  if (!t.pos) return;
  const P = t.pos;
  const p = priceNow(t);
  const side = opp(P.side);
  applyFill(t, side, P.qty * f, slipPx(t, side, p), FEE_TAKER, t.cursor - 1, "市价", lev, mode);
}

export function reversePos(t: Round, lev: number, mode: Pos["mode"]): ActResult {
  if (!t.pos) return { ok: false, error: "没有持仓" };
  const P = t.pos;
  const p = priceNow(t);
  const side = opp(P.side);
  const fill = slipPx(t, side, p);
  const qty = P.qty * 2;
  const nm = needMargin(t, lev, side, qty, fill, FEE_TAKER, "now");
  if (nm.im + nm.fee > availBal(t, p) + posIM(t, p) + 1e-6)
    return { ok: false, error: "保证金不够反手同样大小的仓位" };
  applyFill(t, side, qty, fill, FEE_TAKER, t.cursor - 1, "市价", lev, mode);
  return { ok: true };
}

export function cancelOrder(t: Round, id: number) {
  t.orders = t.orders.filter((o) => o.id !== id);
}

export function validTpSl(t: Round, kind: "tp" | "sl", v: number) {
  const P = t.pos;
  if (!P) return "没有持仓";
  const p = priceNow(t);
  if (!(v > 0)) return "价格不对";
  if (kind === "tp" && (P.side > 0 ? v <= p : v >= p))
    return P.side > 0 ? "做多的止盈要高于最新价" : "做空的止盈要低于最新价";
  if (kind === "sl" && (P.side > 0 ? v >= p : v <= p))
    return P.side > 0 ? "做多的止损要低于最新价" : "做空的止损要高于最新价";
  return "";
}

export function setPosTpSl(t: Round, tp: number | null, sl: number | null): ActResult {
  if (!t.pos) return { ok: false, error: "没有持仓" };
  const e1 = tp == null ? "" : validTpSl(t, "tp", tp);
  const e2 = sl == null ? "" : validTpSl(t, "sl", sl);
  if (e1 || e2) return { ok: false, error: e1 || e2 };
  t.pos.tp = tp;
  t.pos.sl = sl;
  return { ok: true };
}

export function flatten(t: Round, lev: number, mode: Pos["mode"], why: string) {
  if (!t.pos) return;
  const p = priceNow(t);
  const side = opp(t.pos.side);
  applyFill(t, side, t.pos.qty, slipPx(t, side, p), FEE_TAKER, t.cursor - 1, "市价", lev, mode, why);
  t.orders = [];
}

export function newRound(d: Drawn, wallet: number): Round {
  return {
    symbol: d.symbol,
    interval: d.interval,
    bars: d.bars,
    frames: d.frames ?? [],
    view: d.interval,
    ctx: d.ctx,
    cursor: d.ctx,
    pos: null,
    orders: [],
    fills: [],
    wallet,
    startWallet: wallet,
    fees: 0,
    realized: 0,
    peakEq: wallet,
    maxDD: 0,
    oid: 1,
    liqs: 0,
    done: false,
    peeked: false,
    bust: false,
    startedAt: Date.now(),
    drawings: [],
  };
}

export function canSkip(t: Round | null) {
  return !!t && !t.done && t.fills.length === 0 && t.orders.length === 0 && !t.pos;
}
