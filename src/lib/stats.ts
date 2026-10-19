import type { RoundLog } from "./types";

export type Stats = {
  n: number;
  traded: number;
  wins: number;
  losses: number;
  pnl: number;
  fees: number;
  avgW: number | null;
  avgL: number | null;
  pf: number | null;
  liqs: number;
  peeked: number;
  best: number | null;
  worst: number | null;
  gross: number;
};

export function statsOf(rows: RoundLog[]): Stats {
  const traded = rows.filter((r) => r.fills > 0);
  const wins = traded.filter((r) => r.pnl > 0);
  const losses = traded.filter((r) => r.pnl < 0);
  const gw = wins.reduce((a, r) => a + r.pnl, 0);
  const gl = -losses.reduce((a, r) => a + r.pnl, 0);
  return {
    n: rows.length,
    traded: traded.length,
    wins: wins.length,
    losses: losses.length,
    pnl: rows.reduce((a, r) => a + r.pnl, 0),
    fees: rows.reduce((a, r) => a + (r.fees || 0), 0),
    avgW: wins.length ? gw / wins.length : null,
    avgL: losses.length ? gl / losses.length : null,
    pf: gl > 0 ? gw / gl : null,
    liqs: rows.reduce((a, r) => a + (r.liqs || 0), 0),
    peeked: rows.filter((r) => r.peeked).length,
    best: traded.length ? Math.max(...traded.map((r) => r.pnl)) : null,
    worst: traded.length ? Math.min(...traded.map((r) => r.pnl)) : null,
    gross: gw - gl + rows.reduce((a, r) => a + (r.fees || 0), 0),
  };
}

export function download(name: string, text: string, type: string) {
  const b = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
