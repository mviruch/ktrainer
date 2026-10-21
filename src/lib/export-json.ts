import { fmtRelFull } from "./format";
import type { Account, RoundLog, RunLog } from "./types";

/**
 * Desensitised copy of the stats export (「导出 JSON」). Pure: never mutates the inputs / local saves.
 *
 * Rounds with revealed === true are exported as-is. Every other round (blind, reveal failed, old save
 * without the flag) follows the CSV rule:
 *   symbol           → "HIDDEN"
 *   t0               → "D0 00:00"  (relative clock, zero = sessionZero = floor(t0 / 1000))
 *   t1               → "D{n} HH:MM" elapsed since t0, same fmtRelFull as the chart crosshair
 *   base             → dropped (it is the real opening close)
 *   list[].price     → price / base * 100 (same 100-base as the chart); "HIDDEN" if the row has no base
 * Untouched: ts (when it was played), interval, amounts (startW/endW/pnl/fees/n/fee/list[].pnl), maxDD,
 * counts (fills/liqs/bars), list[].i (bar index relative to the open), side/tag/type/reason/peeked/startedAt.
 * account / runs hold only amounts, counts and play times → copied unchanged.
 */
export type ExportRound = Omit<RoundLog, "symbol" | "t0" | "t1" | "list" | "base"> & {
  symbol: string;
  t0: number | string;
  t1: number | string;
  base?: number;
  list: (Omit<RoundLog["list"][number], "price"> & { price: number | string })[];
};

export function blindRound(r: RoundLog): ExportRound {
  if (r.revealed === true) return { ...r, list: r.list.map((f) => ({ ...f })) };
  const { base, t0, t1, list, ...rest } = r;
  const zero = Number.isFinite(t0) ? Math.floor(t0 / 1000) : null;
  const rel = (ms: number) => (zero != null && Number.isFinite(ms) ? fmtRelFull(Math.floor(ms / 1000), zero) || "HIDDEN" : "HIDDEN");
  const ok = typeof base === "number" && base > 0;
  return {
    ...rest,
    symbol: "HIDDEN",
    t0: rel(t0),
    t1: rel(t1),
    list: (list ?? []).map((f) => ({
      ...f,
      price: ok && Number.isFinite(f.price) ? +((f.price / base) * 100).toFixed(4) : "HIDDEN",
    })),
  };
}

// 禁止在导出里加成交数量字段：导出保留了成交额 n，有了数量就能用 n ÷ 数量 算回真实成交价，盲测就失效了。（产品已定）
export function exportJson(account: Account, runs: RunLog[], rounds: RoundLog[]) {
  return JSON.stringify(
    { account: { ...account }, runs: runs.map((x) => ({ ...x })), rounds: rounds.map(blindRound) },
    null,
    2,
  );
}
