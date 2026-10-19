import { advance, newRound, placeOrder } from "../src/lib/engine.ts";
import type { Bar, Drawn } from "../src/lib/types.ts";

function bar(t: number, o: number, h: number, l: number, c: number): Bar {
  return { t, o, h, l, c, v: 10 };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const bars = [
  bar(0, 100, 101, 99, 100),
  bar(3_600_000, 100, 110, 99, 108),
];
const drawn: Drawn = { symbol: "BTCUSDT", interval: "1h", bars, ctx: 1 };
const t = newRound(drawn, 10_000);
const opened = placeOrder(
  t,
  { side: 1, tab: "market", notional: 1000, limit: null, tp: 110, sl: 95, lev: 10 },
  "cross",
);
assert(opened.ok, "open failed");
assert(t.pos?.side === 1, "not long");
assert(t.wallet < 10_000 && t.wallet > 9999, "taker fee missing " + t.wallet);

advance(t, 10, "cross");
assert(t.pos == null, "take profit did not flatten");
assert(t.fills.length === 2, "expected open + tp, got " + t.fills.map((f) => f.tag).join(","));
assert(t.wallet > 10_000, "tp should be profitable, wallet " + t.wallet);

const rest = [
  bar(0, 100, 100, 100, 100),
  bar(3_600_000, 100, 101, 99, 100),
];
const limit = newRound({ symbol: "SOLUSDT", interval: "1h", bars: rest, ctx: 1 }, 10_000);
const hung = placeOrder(
  limit,
  { side: 1, tab: "limit", notional: 500, limit: 99, tp: null, sl: null, lev: 5 },
  "isolated",
);
assert(hung.ok && limit.orders.length === 1, "limit should rest");
advance(limit, 5, "isolated");
assert(limit.orders.length === 0 && limit.pos?.side === 1, "limit should fill on the low");
assert(limit.pos.mode === "isolated", "mode");
assert(limit.fills[0].type === "限价", limit.fills[0].type);

console.log("engine ok", t.wallet.toFixed(2), limit.pos.entry.toFixed(4));
