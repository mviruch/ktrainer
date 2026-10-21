// Run: node --experimental-strip-types scripts/draw-math-check.ts
import { channelCornersTP, indexToX, logicalToTime, priceOnLine, timeToLogical, xToIndex } from "../src/lib/draw-math.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const near = (a: number | null, b: number, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

const M5 = 300;
const H4 = 4 * 3600;
// 5m bars from 0 to 23h55 (288 bars) and 4H bars over the same day (6 bars).
const t5 = Array.from({ length: 288 }, (_, i) => i * M5);
const t4 = Array.from({ length: 6 }, (_, i) => i * H4);

// Exact bar opens map to integer indices.
assert(near(timeToLogical(t5, M5, 600), 2), "5m bar open → index 2");
assert(near(timeToLogical(t4, H4, H4), 1), "4H bar open → index 1");

// Inside a 4H bar: interpolated, not snapped (1h into bar 0 = 0.25).
assert(near(timeToLogical(t4, H4, 3600), 0.25), "inside 4H bar interpolates");
// Point placed on 4H at logical 2.5 → time 10h → on 5m is index 120.
const tFrom4h = logicalToTime(t4, H4, 2.5)!;
assert(near(tFrom4h, 10 * 3600), "4H logical 2.5 → 10h");
assert(near(timeToLogical(t5, M5, tFrom4h), 120), "same time on 5m → 120");
// Point placed on 5m between bars (index 7.4) round-trips.
const t74 = logicalToTime(t5, M5, 7.4)!;
assert(near(timeToLogical(t5, M5, t74), 7.4), "5m round trip");

// Extrapolation both ends, using the interval length.
assert(near(timeToLogical(t4, H4, -2 * H4), -2), "left extrapolation");
assert(near(timeToLogical(t4, H4, 5 * H4 + 2 * H4), 7), "right extrapolation");
assert(near(logicalToTime(t5, M5, -10)!, -10 * M5), "left extrapolate back");
assert(near(logicalToTime(t5, M5, 300)!, 287 * M5 + 13 * M5), "right extrapolate back");

// Gap in data (missing bar): interpolate across the actual neighbours.
const gap = [0, 300, 900, 1200];
assert(near(timeToLogical(gap, M5, 600), 1.5), "gap interpolation");
assert(near(logicalToTime(gap, M5, 1.5)!, 600), "gap inverse");

// Empty input.
assert(timeToLogical([], M5, 0) === null, "empty → null");

// Channel corners are defined in time/price, independent of the interval's pixel scale.
const A = { time: 0, price: 100 };
const B = { time: 8 * 3600, price: 108 };
const C = { time: 4 * 3600, price: 110 };
assert(near(priceOnLine(A, B, C.time), 104), "price on baseline");
const ch = channelCornersTP(A, B, C);
assert(ch.a2.time === A.time && near(ch.a2.price, 106), "a2 = A shifted by +6");
assert(ch.b2.time === B.time && near(ch.b2.price, 114), "b2 = B shifted by +6");
const vert = channelCornersTP({ time: 0, price: 100 }, { time: 0, price: 110 }, { time: 600, price: 0 });
assert(vert.a2.time === 600 && vert.a2.price === 100, "vertical baseline shifts horizontally");

console.log("draw-math ok");

// Pixel mapping from candle coordinates (uneven pixel positions allowed), round trip + extrapolation.
{
  const xs = [100, 106, 112, 130, 136];
  const coordOf = (i: number) => xs[i] ?? null;
  assert(indexToX(5, coordOf, 6, 2.5) === 121, "interp between uneven candle xs");
  assert(indexToX(5, coordOf, 6, -2) === 88, "left extrapolation px");
  assert(indexToX(5, coordOf, 6, 6) === 148, "right extrapolation px");
  for (const idx of [-3.3, 0, 0.4, 2.5, 3.9, 4, 7.25]) {
    const x = indexToX(5, coordOf, 6, idx)!;
    assert(near(xToIndex(5, coordOf, 6, x), idx), `px round trip ${idx}`);
  }
  // Full chain: time placed on 4H → x on 4H → back to time.
  const x4 = (i: number) => 50 + i * 20;
  const t = 9000; // inside 4H bar 0
  const idx = timeToLogical(t4, H4, t)!;
  const back = logicalToTime(t4, H4, xToIndex(6, x4, 20, indexToX(6, x4, 20, idx)!)!)!;
  assert(near(back, t, 1e-6), "time→x→time chain");
}
console.log("draw-math pixel ok");
