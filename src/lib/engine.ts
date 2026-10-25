import { FEE_MAKER, FEE_TAKER, MMR } from "./constants.ts";
import { snapDrawings, takeSnapshot } from "./snapshot.ts";
import type { ActResult, Bar, CaptureIn, CloseReason, Drawn, EventKind, EventSrc, Fill, Order, OrderDraft, Pos, PosStat, Round, Side, Snapshot } from "./types.ts";

/* ---------- review capture helpers ---------- */

function barT(t: Round, i: number) {
  return t.bars[i]?.t ?? 0;
}

function pushEv(
  t: Round,
  kind: EventKind,
  src: EventSrc,
  i: number,
  oid: number | null,
  price: number | null,
  side: Side | null,
  extra: { tp?: number | null; sl?: number | null; why?: string; posId?: number | null } = {},
) {
  if (!t.events) t.events = [];
  t.events.push({ kind, i, t: barT(t, i), oid, price, side, src, ...extra });
}

function statOf(t: Round, pid: number | undefined) {
  return pid == null ? undefined : (t.posStats ?? []).find((s) => s.id === pid);
}

function refreshStat(s: PosStat) {
  const fav = s.side > 0 ? s.hi : s.lo;
  const adv = s.side > 0 ? s.lo : s.hi;
  s.mfePx = fav;
  s.maePx = adv;
  const dFav = Math.max(0, s.side * (fav - s.entry));
  const dAdv = Math.max(0, -s.side * (adv - s.entry));
  s.mfeR = s.risk ? dFav / s.risk : null;
  s.maeR = s.risk ? dAdv / s.risk : null;
  s.rMult = s.riskU ? s.pnl / s.riskU : null;
  s.rMultNet = s.riskU ? (s.pnl - (s.fees ?? 0)) / s.riskU : null;
}

/** Bar extreme (or intrabar trigger price) at bar i. Never a fill price. */
function touchStat(s: PosStat, p: number, i: number) {
  if (p > s.hi) {
    s.hi = p;
    if (s.side > 0) s.mfeI = i;
    else s.maeI = i;
  }
  if (p < s.lo) {
    s.lo = p;
    if (s.side > 0) s.maeI = i;
    else s.mfeI = i;
  }
  refreshStat(s);
}

function trackRisk(s: PosStat, P: Pos) {
  if (!P.sl) return;
  const r = Math.abs(P.entry - P.sl) * P.qty;
  if (s.riskUMax == null || r > s.riskUMax) s.riskUMax = r;
}

function setSl0(s: PosStat, sl: number) {
  s.sl0 = sl;
  s.risk = Math.abs(s.entry - sl) || null;
  s.riskU = s.risk ? s.risk * s.qty0 : null;
  refreshStat(s);
}

/** trigger: intrabar close level (TP / SL / liq / limit), counted as reached in bar idx; null for bar-close exits. */
function closeStat(t: Round, pid: number | undefined, idx: number, trigger: number | null, reason: CloseReason) {
  const s = statOf(t, pid);
  if (!s || s.closeI != null) return;
  if (trigger != null && idx > s.openI) touchStat(s, trigger, idx);
  s.closeI = idx;
  s.bars = idx - s.openI;
  s.reason = reason;
  refreshStat(s);
}

type FillMeta = {
  oid: number;
  orderPrice: number | null;
  /** Reason used if this fill closes a position. */
  reason: CloseReason;
  /** Set when the fill happens inside a bar (advance): the price level reached there (limit / TP / SL). */
  intrabar?: number | null;
  view: Fill["view"];
  snap: Snapshot | null;
};

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

/**
 * True zero-net price: side*qty*(p-entry) - openFee - qty*p*FEE_TAKER = 0.
 * openFee = attributed open/add fees for remaining size (else entry*FEE_TAKER*qty).
 * Long: p = (entry + openFee/qty) / (1 - f); short: p = (entry - openFee/qty) / (1 + f).
 */
export function breakEvenPrice(t: Round) {
  const P = t.pos;
  if (!P || !(P.qty > 0)) return null;
  const f = FEE_TAKER;
  const q = P.qty;
  const e = P.entry;
  let openedQty = 0;
  let openedFee = 0;
  const pid = P.pid;
  if (pid != null) {
    for (const fill of t.fills) {
      if (fill.openPosId === pid) {
        // Opening leg. Reverse fills also close another pos; open size is qty0 on the new stat.
        const st = statOf(t, pid);
        const legQ =
          fill.posId != null && fill.posId !== pid
            ? Math.min(fill.qty, st?.qty0 && st.qty0 > 0 ? st.qty0 : fill.qty)
            : fill.qty;
        if (!(legQ > 0) || !(fill.qty > 0)) continue;
        openedQty += legQ;
        openedFee += fill.fee * (legQ / fill.qty);
      } else if (fill.posId === pid && fill.side === P.side && !fill.reason) {
        openedQty += fill.qty;
        openedFee += fill.fee;
      }
    }
  }
  const openFee = openedQty > 1e-12 ? openedFee * (q / openedQty) : q * e * f;
  const be = P.side > 0 ? (e + openFee / q) / (1 - f) : (e - openFee / q) / (1 + f);
  return be > 0 && Number.isFinite(be) ? be : null;
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
  if (!t.posStats) t.posStats = [];
  const id = t.posStats.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  t.pos.pid = id;
  t.posStats.push({
    id, side, openI: idx, closeI: null, bars: null, entry: price, qty0: qty, sl0: null, risk: null, riskU: null,
    hi: price, lo: price, mfePx: price, maePx: price, mfeR: null, maeR: null, mfeI: null, maeI: null,
    fees: 0, riskUMax: null, pnl: 0, rMult: null, rMultNet: null, adds: 0, reason: null,
  });
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
  why: string | undefined,
  m: FillMeta,
): Fill | null {
  if (!(qty > 0) || !(price > 0)) return null;
  const P = t.pos;
  const tp0 = P?.tp ?? null;
  const sl0 = P?.sl ?? null;
  let closeQ = 0;
  let realized = 0;
  let posId: number | null = null;
  if (P && P.side !== side) {
    closeQ = Math.min(qty, P.qty);
    realized = P.side * closeQ * (price - P.entry);
    if (P.mode === "isolated") P.margin -= (P.margin * closeQ) / P.qty;
    P.qty -= closeQ;
    posId = P.pid ?? null;
    const st = statOf(t, P.pid);
    if (st) {
      st.pnl += realized;
      st.fees = (st.fees ?? 0) + qty * price * feeRate * (closeQ / qty);
      refreshStat(st);
    }
    if (P.qty * price < 1e-6) {
      t.pos = null;
      closeStat(t, P.pid, idx, m.intrabar ?? null, m.reason);
    }
  }
  let openPosId: number | null = null;
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
      const st = statOf(t, t.pos.pid);
      if (st) {
        st.adds++;
        st.fees = (st.fees ?? 0) + openQ * price * feeRate;
        refreshStat(st);
      }
      posId = t.pos.pid ?? null;
    } else {
      tag = openPos(t, side, openQ, price, lev, mode, idx, closeQ);
      openPosId = (t.pos as Pos | null)?.pid ?? null;
      const ns = statOf(t, openPosId ?? undefined);
      if (ns) ns.fees = openQ * price * feeRate;
      if (posId == null) posId = openPosId;
    }
  } else tag = "平" + oppL;
  const fee = qty * price * feeRate;
  t.wallet += realized - fee;
  t.fees += fee;
  t.realized += realized;
  const rec: Fill = {
    i: idx,
    side,
    qty,
    price,
    fee,
    pnl: realized,
    n: qty * price,
    tag: why ? why + (closeQ > 0 ? "·平" + oppL : "") : tag,
    type,
    oid: m.oid,
    t: barT(t, idx),
    view: m.view,
    lev,
    tp: closeQ > 0 ? tp0 : (t.pos?.tp ?? null),
    sl: closeQ > 0 ? sl0 : (t.pos?.sl ?? null),
    orderPrice: m.orderPrice,
    reason: closeQ > 0 ? m.reason : null,
    posId,
    openPosId,
    snap: m.snap,
  };
  t.fills.push(rec);
  return rec;
}

/** Attach the order's TP/SL to the position it opened / added to; first-open SL fixes R. */
function attachTpSl(t: Round, f: Fill | null, side: Side, tp: number | null, sl: number | null, oid: number) {
  if (!f || !t.pos || t.pos.side !== side) return;
  if (tp) t.pos.tp = tp;
  if (sl) t.pos.sl = sl;
  if (tp || sl) pushEv(t, "tpsl", "order", f.i, oid, f.price, side, { tp: t.pos.tp, sl: t.pos.sl, why: "随单设置", posId: t.pos.pid ?? null });
  const st = statOf(t, t.pos.pid);
  if (st && f.openPosId === st.id && st.sl0 == null && sl) setSl0(st, sl);
  if (st && (f.openPosId === st.id || f.tag.startsWith("加"))) trackRisk(st, t.pos);
  f.tp = t.pos.tp;
  f.sl = t.pos.sl;
}

function fillOrder(t: Round, o: Order, price: number, idx: number, lev: number, mode: Pos["mode"], msgs: string[]) {
  t.orders = t.orders.filter((x) => x !== o);
  const nm = needMargin(t, lev, o.side, o.qty, price, FEE_MAKER, o.id);
  if (nm.im + nm.fee > availBal(t) + 1e-6) {
    pushEv(t, "cancel", "limit", idx, o.id, o.price, o.side, { why: "保证金不足，触发时自动撤单" });
    msgs.push("保证金不足，一笔限价单成交不了，已撤销");
    return;
  }
  pushEv(t, "trigger", "limit", idx, o.id, price, o.side, { posId: t.pos?.pid ?? null });
  const f = applyFill(t, o.side, o.qty, price, FEE_MAKER, idx, "限价", lev, mode, undefined, {
    oid: o.id,
    orderPrice: o.price,
    intrabar: price,
    reason: "manual",
    view: o.view ?? null,
    snap: o.snap ?? null,
  });
  attachTpSl(t, f, o.side, o.tp, o.sl, o.id);
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
  const oid = t.oid++;
  pushEv(t, "trigger", "liq", idx, oid, at, opp(P.side), { posId: P.pid ?? null });
  const st = statOf(t, P.pid);
  if (st) {
    st.pnl += raw;
    st.fees = (st.fees ?? 0) + paidFee;
  }
  closeStat(t, P.pid, idx, at, "liq");
  for (const o of t.orders) pushEv(t, "cancel", "liq", idx, o.id, o.price, o.side, { why: "强平后撤单" });
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
    oid,
    t: barT(t, idx),
    view: null,
    lev: P.lev,
    tp: P.tp,
    sl: P.sl,
    orderPrice: at,
    reason: "liq",
    posId: P.pid ?? null,
    openPosId: null,
    snap: null,
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
      const oid = t.oid++;
      const k = best.kind === "tp" ? "tp" : "sl";
      pushEv(t, "trigger", k, idx, oid, at, side, { posId: P.pid ?? null });
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
        { oid, orderPrice: at, intrabar: at, reason: k, view: null, snap: null },
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
  const st = statOf(t, t.pos?.pid);
  if (st && st.closeI == null && st.openI < t.cursor - 1) {
    touchStat(st, k.h, t.cursor - 1);
    touchStat(st, k.l, t.cursor - 1);
  }
  const eq = equityAt(t, k.c);
  if (eq > t.peakEq) t.peakEq = eq;
  if (t.peakEq > 0) t.maxDD = Math.max(t.maxDD, (t.peakEq - eq) / t.peakEq);
  return { needMore: false, toasts };
}

export function placeOrder(t: Round, d: OrderDraft, mode: Pos["mode"], cap?: CaptureIn): ActResult {
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
    const oid = t.oid++;
    const src = d.tab === "market" ? "market" : "limit";
    pushEv(t, "trigger", src, idx, oid, fill, d.side, { posId: t.pos?.pid ?? null });
    const f = applyFill(t, d.side, qty, fill, FEE_TAKER, idx, d.tab === "market" ? "市价" : "限价·吃单", d.lev, mode, undefined, {
      oid,
      orderPrice: d.tab === "market" ? null : price,
      reason: "manual",
      view: cap?.view ?? t.view,
      snap: takeSnapshot(t, cap),
    });
    attachTpSl(t, f, d.side, d.tp, d.sl, oid);
    return d.tab === "limit"
      ? { ok: true, info: "限价单价格已经穿过最新价，直接按市价成交（收吃单手续费）" }
      : { ok: true };
  }
  const qty = d.notional / price;
  const nm = needMargin(t, d.lev, d.side, qty, price, FEE_MAKER);
  if (nm.im + nm.fee > availBal(t, p) + 1e-6) return { ok: false, error: "可用保证金不足，减少数量或加杠杆" };
  const oid = t.oid++;
  t.orders.push({
    id: oid,
    side: d.side,
    price,
    qty,
    im: nm.im + nm.fee,
    tp: d.tp,
    sl: d.sl,
    at: idx,
    view: cap?.view ?? t.view,
    snap: takeSnapshot(t, cap),
  });
  pushEv(t, "place", "limit", idx, oid, price, d.side, { tp: d.tp, sl: d.sl });
  return { ok: true, info: `已挂${d.side > 0 ? "买" : "卖"}单` };
}

function manualMarket(t: Round, side: Side, qty: number, lev: number, mode: Pos["mode"], cap: CaptureIn | undefined) {
  const p = priceNow(t);
  const idx = t.cursor - 1;
  const fill = slipPx(t, side, p);
  const oid = t.oid++;
  pushEv(t, "trigger", "market", idx, oid, fill, side, { posId: t.pos?.pid ?? null });
  return applyFill(t, side, qty, fill, FEE_TAKER, idx, "市价", lev, mode, undefined, {
    oid,
    orderPrice: null,
    reason: "manual",
    view: cap?.view ?? t.view,
    snap: takeSnapshot(t, cap),
  });
}

export function closePct(t: Round, f: number, lev: number, mode: Pos["mode"], cap?: CaptureIn) {
  if (!t.pos) return;
  const P = t.pos;
  manualMarket(t, opp(P.side), P.qty * f, lev, mode, cap);
}

export function reversePos(t: Round, lev: number, mode: Pos["mode"], cap?: CaptureIn): ActResult {
  if (!t.pos) return { ok: false, error: "没有持仓" };
  const P = t.pos;
  const p = priceNow(t);
  const side = opp(P.side);
  const fill = slipPx(t, side, p);
  const qty = P.qty * 2;
  const nm = needMargin(t, lev, side, qty, fill, FEE_TAKER, "now");
  if (nm.im + nm.fee > availBal(t, p) + posIM(t, p) + 1e-6)
    return { ok: false, error: "保证金不够反手同样大小的仓位" };
  manualMarket(t, side, qty, lev, mode, cap);
  return { ok: true };
}

export function cancelOrder(t: Round, id: number, why = "手动撤单") {
  const o = t.orders.find((x) => x.id === id);
  if (!o) return;
  pushEv(t, "cancel", "manual", t.cursor - 1, o.id, o.price, o.side, { why });
  t.orders = t.orders.filter((x) => x !== o);
}

export function cancelAll(t: Round, why = "全部撤单", src: EventSrc = "manual") {
  for (const o of t.orders) pushEv(t, "cancel", src, t.cursor - 1, o.id, o.price, o.side, { why });
  t.orders = [];
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
  pushEv(t, "tpsl", "manual", t.cursor - 1, null, priceNow(t), t.pos.side, { tp, sl, why: "修改止盈止损", posId: t.pos.pid ?? null });
  return { ok: true };
}

export function flatten(t: Round, lev: number, mode: Pos["mode"], why: string) {
  if (t.pos) {
    const p = priceNow(t);
    const side = opp(t.pos.side);
    const idx = t.cursor - 1;
    const fill = slipPx(t, side, p);
    const oid = t.oid++;
    pushEv(t, "trigger", "round_end", idx, oid, fill, side, { posId: t.pos.pid ?? null });
    applyFill(t, side, t.pos.qty, fill, FEE_TAKER, idx, "市价", lev, mode, why, {
      oid,
      orderPrice: null,
      reason: "round_end",
      view: null,
      snap: null,
    });
  }
  cancelAll(t, "局终撤单", "round_end");
}

/** Round end: flat everything, cancel orders, snapshot drawings. */
export function finishRound(t: Round, lev: number, mode: Pos["mode"]) {
  flatten(t, lev, mode, "结束");
  t.endDrawings = snapDrawings(t.drawings);
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
    events: [],
    posStats: [],
    endDrawings: null,
  };
}

export function canSkip(t: Round | null) {
  return !!t && !t.done && t.fills.length === 0 && t.orders.length === 0 && !t.pos;
}
