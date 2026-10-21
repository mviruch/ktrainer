// Run: node --experimental-strip-types scripts/mfe-mae-check.ts
// MFE / MAE = bar high / low only (bars after the open bar; an intrabar TP/SL/liq/limit close counts up to its trigger price).
// Fill prices (with slippage) never count. Also: risk_u_max, fees per position (r net), mfe/mae bar.
import { advance, closePct, finishRound, newRound, placeOrder, setPosTpSl } from "../src/lib/engine.ts";
import type { Bar, Drawn, OrderDraft, Round } from "../src/lib/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("FAIL: " + msg);
}
const near = (a: number | null | undefined, b: number, eps = 1e-9) => a != null && Math.abs(a - b) < eps;
function mk(path: [number, number, number, number][]): Round {
  const pre: Bar[] = Array.from({ length: 400 }, (_, i) => ({ t: i * 3e5, o: 100, h: 100, l: 100, c: 100, v: 10 }));
  const post: Bar[] = path.map(([o, h, l, c], i) => ({ t: (400 + i) * 3e5, o, h, l, c, v: 10 }));
  const d: Drawn = { symbol: "SOLUSDT", interval: "5m", bars: [...pre, ...post], frames: [], ctx: 400 };
  return newRound(d, 10000);
}
const draft = (x: Partial<OrderDraft>): OrderDraft => ({ side: 1, tab: "market", notional: 1000, limit: null, tp: null, sl: null, lev: 5, ...x });

// A. quiet round (reproduces "mfe = add price, mae = close price"): bars barely move, slipped fills sit outside them
{
  const t = mk([[100, 100.01, 99.99, 100], [100, 100.015, 99.992, 100.01], [100.01, 100.012, 99.985, 99.99], [99.99, 100.0, 99.98, 99.99], [99.99, 99.995, 99.98, 99.99]]);
  placeOrder(t, draft({ sl: 99 }), "cross"); // fill 100*(1+0.0003) = 100.03
  advance(t, 5, "cross"); // bar 400
  advance(t, 5, "cross"); // bar 401
  placeOrder(t, draft({ notional: 500 }), "cross"); // add at 100.01*(1.0003) = 100.040003 > any bar high
  advance(t, 5, "cross"); // bar 402
  closePct(t, 0.5, 5, "cross"); // sell at 99.99*(0.9997) < any bar low
  advance(t, 5, "cross"); // bar 403
  finishRound(t, 5, "cross");
  const s = t.posStats[0];
  const addPx = t.fills[1].price, closePx = t.fills[2].price;
  console.log("  A quiet:", JSON.stringify({ mfePx: s.mfePx, maePx: s.maePx, addPx, closePx }));
  assert(s.mfePx !== addPx && s.maePx !== closePx, "A: fill prices must not be extremes");
  // highest bar high (100.015) never got above the slipped entry 100.03 → no favourable excursion
  assert(near(s.mfePx, s.entry) && s.mfeI === null && s.mfeR === 0, "A: MFE = entry, no favourable bar");
  assert(near(s.maePx, 99.98) && s.maeI === 403, `A: MAE = lowest bar low 99.98 @403 (${s.maePx} @${s.maeI})`);
}
// B. volatile round: bar highs beyond fills (old code happened to be right here), TP intrabar counts up to trigger only
{
  const t = mk([[100, 101, 99.5, 100.5], [100.5, 102.2, 100.2, 102], [102, 104, 101.5, 103.5]]);
  placeOrder(t, draft({ sl: 98, tp: 103 }), "cross");
  advance(t, 5, "cross"); // 400: h 101 l 99.5
  advance(t, 5, "cross"); // 401: h 102.2
  advance(t, 5, "cross"); // 402: TP 103 hit intrabar (bar high 104 must not count)
  const s = t.posStats[0];
  console.log("  B volatile:", JSON.stringify({ mfePx: s.mfePx, maePx: s.maePx, mfeI: s.mfeI, maeI: s.maeI }));
  assert(near(s.mfePx, 103) && s.mfeI === 402, "B: TP bar counts up to the trigger 103, not 104");
  assert(near(s.maePx, 99.5) && s.maeI === 400, "B: MAE from bar low");
  assert(near(s.mfeR, (103 - s.entry) / (s.entry - 98)), "B: mfe R");
}
// C. no bar held after open → no excursion
{
  const t = mk([[100, 101, 99, 100]]);
  placeOrder(t, draft({ sl: 99 }), "cross");
  finishRound(t, 5, "cross");
  const s = t.posStats[0];
  assert(near(s.mfePx, s.entry) && near(s.maePx, s.entry) && s.mfeI === null && s.maeI === null && s.mfeR === 0 && s.maeR === 0, "C: open bar not counted");
}
// D. risk_u_max over adds; R denominator stays first fill; net R subtracts this position's fees
{
  const t = mk([[100, 100.5, 99.8, 100.2], [100.2, 100.6, 100, 100.4], [100.4, 101, 100.3, 100.9]]);
  placeOrder(t, draft({ sl: 99 }), "cross");
  const r0 = t.posStats[0].riskU!;
  advance(t, 5, "cross");
  placeOrder(t, draft({ notional: 2000 }), "cross"); // add, SL still 99 → bigger risk
  const P = t.pos!;
  const rAdd = Math.abs(P.entry - 99) * P.qty;
  setPosTpSl(t, null, 100); // tighter SL afterwards: max must not drop
  advance(t, 5, "cross");
  advance(t, 5, "cross");
  finishRound(t, 5, "cross");
  const s = t.posStats[0];
  assert(near(s.riskU, r0) && near(s.riskUMax, rAdd, 1e-6) && s.riskUMax! > r0, `D: risk_u_max ${s.riskUMax} vs first ${r0}`);
  const fees = t.fills.reduce((a, f) => a + f.fee, 0);
  assert(near(s.fees, fees, 1e-9), "D: position fees = all its fills' fees");
  assert(near(s.rMult, s.pnl / r0) && near(s.rMultNet, (s.pnl - fees) / r0), "D: r gross / net");
}
console.log("mfe-mae ok");
