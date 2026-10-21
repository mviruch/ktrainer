/* Per-round review detail kept forever (separate localStorage key "fut-review", never read by the legacy
   CSV / JSON exports, which only see fut-log). Pure: no DOM; persist.ts does the actual store I/O. */
import { FILL_CAP } from "./constants.ts";
import { snapDrawings } from "./snapshot.ts";
import type { Drawing, Fill, OrderEvent, PosStat, Round } from "./types.ts";

export const REVIEW_KEY = "fut-review";
/** Same retention as fut-log (saveLog keeps 600 rows). */
export const REVIEW_KEEP = 600;

export type ReviewFill = Omit<Fill, "snap">;

export type ReviewRec = {
  v: 1;
  /** Joins with RoundLog.startedAt and the IndexedDB snapshot record. */
  startedAt: number;
  /** Round.ctx: bars[ctx-1] is the opening bar (D0); Fill.i - (ctx-1) = legacy relative bar index. */
  ctx?: number;
  fills: ReviewFill[];
  /** Fills beyond FILL_CAP that were dropped (0 = none). */
  fillsCut: number;
  events: OrderEvent[];
  posStats: PosStat[];
  endDrawings: Drawing[];
};

export function toReview(t: Round): ReviewRec {
  return {
    v: 1,
    startedAt: t.startedAt,
    ctx: t.ctx,
    fills: t.fills.slice(0, FILL_CAP).map((f) => {
      const c = { ...f };
      delete c.snap;
      return c;
    }),
    fillsCut: Math.max(0, t.fills.length - FILL_CAP),
    events: (t.events ?? []).map((e) => ({ ...e })),
    posStats: (t.posStats ?? []).map((s) => ({ ...s })),
    endDrawings: t.endDrawings ?? snapDrawings(t.drawings),
  };
}

/** Replace a row with the same startedAt (idempotent settle) and trim to `keep`. */
export function appendReview(rows: ReviewRec[], rec: ReviewRec, keep = REVIEW_KEEP): ReviewRec[] {
  const out = rows.filter((r) => r && r.startedAt !== rec.startedAt).concat(rec);
  return out.length > keep ? out.slice(-keep) : out;
}
