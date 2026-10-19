export function uFmt(v: number, d = 2) {
  return (+v || 0).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function sgnU(v: number) {
  return (v > 0 ? "+" : v < 0 ? "-" : "") + uFmt(Math.abs(v));
}

export function pctFmt(v: number) {
  return (v > 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
}

export function displayPrice(p: number, base: number | null) {
  return base ? (p / base) * 100 : p;
}

export function realPrice(v: number, base: number | null) {
  return base ? (v * base) / 100 : v;
}

export function fmtNum(v: number, blind: boolean) {
  const a = Math.abs(v);
  if (!blind) return v.toFixed(a >= 1000 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 5);
  return v
    .toFixed(a >= 1000 ? 2 : a >= 10 ? 3 : 4)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

export function fmtPrice(p: number | null | undefined, base: number | null) {
  if (p == null || !Number.isFinite(p)) return "—";
  return fmtNum(displayPrice(p, base), base != null);
}

export function parsePrice(s: string, base: number | null) {
  const v = parseFloat(String(s || "").replace(/[^0-9.eE+-]/g, ""));
  return Number.isFinite(v) && v > 0 ? realPrice(v, base) : NaN;
}

export function bjDate(t: number) {
  return new Date(t + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
}

export function volFmt(v: number) {
  return v >= 1e9
    ? (v / 1e9).toFixed(1) + "B"
    : v >= 1e6
      ? (v / 1e6).toFixed(1) + "M"
      : v >= 1e3
        ? (v / 1e3).toFixed(1) + "K"
        : v.toFixed(0);
}

export function blindBaseOf(bars: { c: number }[], ctx: number, done: boolean) {
  if (done) return null;
  const c = bars[ctx - 1]?.c;
  return c > 0 ? c : null;
}
