/**
 * Continuous time ↔ logical-index mapping for drawings (pure, no chart dependency).
 *
 * Anchors store a real timestamp (seconds) + real price. On any interval the x position comes from
 * the bar open times currently on the time scale:
 *   - inside the data: linear interpolation between the two neighbouring bar opens
 *     (a point inside a 4H bar lands proportionally between that bar and the next, no edge snap);
 *   - left of the first / right of the last bar: extrapolate with the interval length.
 * The inverse maps a fractional logical index back to a continuous time, so a point placed on 4H
 * sits at the same spot when viewed on 5m.
 */

/** Largest i with times[i] <= t (times ascending, non-empty). */
function floorIndex(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Fractional logical index for time t. `step` = interval length in seconds (used outside the data). */
export function timeToLogical(times: readonly number[], step: number, t: number): number | null {
  const n = times.length;
  if (!n || !Number.isFinite(t)) return null;
  const s = step > 0 ? step : 1;
  if (t <= times[0]) return (t - times[0]) / s;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / s;
  const i = floorIndex(times, t);
  const span = times[i + 1] - times[i];
  return span > 0 ? i + (t - times[i]) / span : i;
}

/** Continuous time for a fractional logical index (inverse of timeToLogical). */
export function logicalToTime(times: readonly number[], step: number, logical: number): number | null {
  const n = times.length;
  if (!n || !Number.isFinite(logical)) return null;
  const s = step > 0 ? step : 1;
  if (logical <= 0) return times[0] + logical * s;
  if (logical >= n - 1) return times[n - 1] + (logical - (n - 1)) * s;
  const i = Math.floor(logical);
  return times[i] + (logical - i) * (times[i + 1] - times[i]);
}

/** Price on line A→B at time t (linear in time). Vertical A/B → A's price. */
export function priceOnLine(a: { time: number; price: number }, b: { time: number; price: number }, t: number): number {
  const dt = b.time - a.time;
  if (dt === 0) return a.price;
  return a.price + ((b.price - a.price) * (t - a.time)) / dt;
}

/**
 * Parallel-channel corners in time/price space (scale invariant, so the shape is identical on every interval):
 * the second line is A→B shifted by C's vertical offset from A→B; a2/b2 share A/B's times.
 * If A and B share a time (vertical baseline) the shift is horizontal instead.
 */
export function channelCornersTP(
  a: { time: number; price: number },
  b: { time: number; price: number },
  c: { time: number; price: number },
) {
  if (a.time === b.time) {
    const dt = c.time - a.time;
    return { a, b, a2: { time: a.time + dt, price: a.price }, b2: { time: b.time + dt, price: b.price } };
  }
  const off = c.price - priceOnLine(a, b, c.time);
  return { a, b, a2: { time: a.time, price: a.price + off }, b2: { time: b.time, price: b.price + off } };
}

/**
 * Pixel x for a fractional candle index, from the pixel x of each candle (coordOf, ascending) and the
 * bar spacing (pixels per bar) used past either end. Uses candle coordinates rather than the scale's
 * logical index, so it stays right even if other series add extra points to the time scale.
 */
export function indexToX(n: number, coordOf: (i: number) => number | null, spacing: number, idx: number): number | null {
  if (n <= 0 || !Number.isFinite(idx)) return null;
  if (idx <= 0 || n === 1) {
    const x0 = coordOf(0);
    return x0 == null ? null : x0 + idx * spacing;
  }
  if (idx >= n - 1) {
    const xl = coordOf(n - 1);
    return xl == null ? null : xl + (idx - (n - 1)) * spacing;
  }
  const i = Math.floor(idx);
  const xa = coordOf(i);
  const xb = coordOf(i + 1);
  if (xa == null || xb == null) return null;
  return xa + (idx - i) * (xb - xa);
}

/** Inverse of indexToX: fractional candle index under pixel x (binary search, extrapolate past the ends). */
export function xToIndex(n: number, coordOf: (i: number) => number | null, spacing: number, x: number): number | null {
  if (n <= 0 || !Number.isFinite(x) || !(spacing > 0)) return null;
  const x0 = coordOf(0);
  const xl = coordOf(n - 1);
  if (x0 == null || xl == null) return null;
  if (x <= x0 || n === 1) return (x - x0) / spacing;
  if (x >= xl) return n - 1 + (x - xl) / spacing;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const xm = coordOf(mid);
    if (xm == null) return null;
    if (xm <= x) lo = mid;
    else hi = mid;
  }
  const xa = coordOf(lo)!;
  const xb = coordOf(hi)!;
  return xb > xa ? lo + (x - xa) / (xb - xa) : lo;
}
