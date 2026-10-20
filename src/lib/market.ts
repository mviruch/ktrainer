import { FALLBACK_TOP, FIXED, IV_MS, IV_OK, NOT_COIN } from "./constants";
import { store } from "./store";
import type { Bar, Config, Drawn, Frame, Interval } from "./types";

function parseKlines(j: unknown): Bar[] | null {
  if (!Array.isArray(j)) return null;
  return j.map((row) => {
    const k = row as number[];
    return { t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] };
  });
}

type Src = {
  name: string;
  hosts: string[];
  iv: Record<string, string>;
  cap: number;
  url: (h: string, s: string, b: string, st: number, n: number) => string;
  parse: (j: unknown) => Bar[] | null;
};

const CSRC: Src[] = [
  {
    name: "币安合约",
    hosts: ["https://fapi.binance.com"],
    iv: { "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" },
    cap: 1500,
    url: (h, s, b, st, n) => `${h}/fapi/v1/klines?symbol=${s}&interval=${b}&startTime=${st}&limit=${n}`,
    parse: parseKlines,
  },
  {
    name: "币安现货",
    hosts: ["https://data-api.binance.vision", "https://api.binance.com"],
    iv: { "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" },
    cap: 1000,
    url: (h, s, b, st, n) => `${h}/api/v3/klines?symbol=${s}&interval=${b}&startTime=${st}&limit=${n}`,
    parse: parseKlines,
  },
  {
    name: "Bybit合约",
    hosts: ["https://api.bybit.com"],
    iv: { "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" },
    cap: 1000,
    url: (h, s, b, st, n) =>
      `${h}/v5/market/kline?category=linear&symbol=${s}&interval=${b}&start=${st}&limit=${n}`,
    parse: (j) => {
      const list = (j as { result?: { list?: unknown[] } })?.result?.list;
      return Array.isArray(list)
        ? list
            .map((k) => {
              const row = k as string[];
              return { t: +row[0], o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5] };
            })
            .sort((a, b) => a.t - b.t)
        : null;
    },
  },
];

const deadHost: Record<string, boolean> = {};

export function clearDeadHosts() {
  for (const k of Object.keys(deadHost)) delete deadHost[k];
}

async function tryFetch(url: string, ms = 7000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    return r;
  } catch (e) {
    clearTimeout(to);
    const name = e instanceof Error ? e.name : "";
    throw new Error(name === "AbortError" ? "超时(7秒无响应)" : "连不上(网络被拦 / 跨域被拒)", { cause: e });
  }
}

type FeedErr = Error & { detail?: string[]; allEmpty?: boolean };

export async function fetchCrypto(symbol: string, iv: string, startTime: number, want: number) {
  const errs: string[] = [];
  let reached = false;
  for (const src of CSRC) {
    const bar = src.iv[iv];
    if (!bar) continue;
    for (const h of src.hosts) {
      const tag = `${src.name} ${h.replace(/^https:\/\//, "")}`;
      if (deadHost[h]) {
        errs.push(`${tag}: 已确认不可达,跳过`);
        continue;
      }
      try {
        let out: Bar[] = [];
        let st = startTime;
        let guard = 0;
        while (out.length < want && guard++ < 8) {
          const n = Math.min(src.cap, want - out.length);
          const res = await tryFetch(src.url(h, symbol, bar, Math.floor(st), n));
          if (!res.ok) {
            throw new Error(
              "HTTP " +
                res.status +
                (res.status === 451 ? "(地区限制)" : res.status === 403 ? "(被拒绝)" : ""),
            );
          }
          reached = true;
          const parsed = src.parse(await res.json());
          if (!parsed) throw new Error("返回格式异常");
          const last = out.length ? out[out.length - 1].t : -1;
          const fresh = parsed.filter((x) => x.t > last && Number.isFinite(x.o) && x.o > 0);
          if (!fresh.length) break;
          out = out.concat(fresh);
          st = out[out.length - 1].t + (IV_MS[iv] || 36e5);
        }
        if (out.length) return out;
        errs.push(`${tag}: 返回空(该时段可能没有数据)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errs.push(`${tag}: ${msg}`);
        if (/连不上|超时/.test(msg)) deadHost[h] = true;
      }
    }
  }
  const err = new Error(reached ? "接口通,但这个交易对拿不到K线" : "加密行情源全部不可用") as FeedErr;
  err.detail = errs;
  err.allEmpty = reached;
  throw err;
}

export async function fetchMore(symbol: string, iv: string, from: number, want = 500) {
  try {
    const bars = await fetchCrypto(symbol, iv, from, want);
    return bars.length ? bars : null;
  } catch {
    return null;
  }
}

const LISTED_TTL = 30 * 864e5;
type Listed = Record<string, { t: number | null; at: number }>;
let LISTED = store.get<Listed>("fut-listed", {});

function listedKnown(sym: string) {
  const e = LISTED[sym];
  if (!e) return undefined;
  if (e.t == null && Date.now() - e.at > LISTED_TTL) return undefined;
  return e.t;
}

async function firstBarTime(sym: string) {
  const known = listedKnown(sym);
  if (known !== undefined) return known;
  let t: number | null = null;
  try {
    const b = await fetchCrypto(sym, "1d", 0, 1);
    if (b.length) t = b[0].t;
  } catch (e) {
    if (!(e as FeedErr).allEmpty) return undefined;
  }
  LISTED = { ...LISTED, [sym]: { t, at: Date.now() } };
  store.set("fut-listed", LISTED);
  return t;
}

function fitsSpan(sym: string, span: number) {
  const t = listedKnown(sym);
  if (t === undefined) return true;
  return t !== null && Date.now() - t > span + 864e5;
}

const RECENT_KEEP = 24;
const recentDraws = () => store.get<string[]>("recent", []);

function drawTag(sym: string, iv: string, t: number) {
  const d = new Date(t);
  return `${sym}|${iv}|${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

function chosenIntervals(cfg: Config): Interval[] {
  const set = new Set(cfg.intervals.split(",").filter(isInterval));
  return IV_OK.filter((iv) => set.has(iv));
}

/* 开局之前的长周期。跟基础周期重叠的那一根也留下，等它收盘后替换掉不完整的拼柱。 */
async function loadFrames(sym: string, ivs: Interval[], firstBase: number) {
  const frames: Frame[] = [];
  await Promise.all(
    ivs.map(async (iv) => {
      const ms = IV_MS[iv];
      const start = Math.floor(firstBase / ms) * ms - (FIXED.ctxMax - 1) * ms;
      try {
        const bars = await fetchCrypto(sym, iv, start, FIXED.ctxMax + 2);
        const keep = bars.filter((b) => b.t < firstBase);
        if (keep.length) frames.push({ interval: iv, bars: keep });
      } catch {
        /* 这一档没有，本局就少一个周期 */
      }
    }),
  );
  return IV_OK.filter((iv) => frames.some((f) => f.interval === iv)).map((iv) => frames.find((f) => f.interval === iv)!);
}

function pushRecent(tag: string) {
  store.set("recent", recentDraws().filter((x) => x !== tag).concat(tag).slice(-RECENT_KEEP));
}

const TOP_TTL = 12 * 3600e3;
let TOP = store.get<{ at: number; list: string[] } | null>("fut-top", null);

async function fetchTop() {
  if (TOP && Date.now() - TOP.at < TOP_TTL && TOP.list && TOP.list.length >= 30) return TOP.list;
  try {
    const r = await tryFetch("https://fapi.binance.com/fapi/v1/ticker/24hr", 9000);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = (await r.json()) as { symbol?: string; quoteVolume?: string }[];
    if (!Array.isArray(j)) throw new Error("返回格式异常");
    const list = j
      .filter((x) => /^[A-Z0-9]+USDT$/.test(x.symbol || "") && !NOT_COIN.test(x.symbol || "") && +(x.quoteVolume || 0) > 0)
      .sort((a, b) => +(b.quoteVolume || 0) - +(a.quoteVolume || 0))
      .slice(0, 100)
      .map((x) => x.symbol as string);
    if (list.length >= 30) {
      TOP = { at: Date.now(), list };
      store.set("fut-top", TOP);
      return list;
    }
    throw new Error("排行太短");
  } catch {
    if (TOP?.list?.length) return TOP.list;
    return null;
  }
}

async function symbolPool(cfg: Config) {
  if (cfg.pool === "btc") return { list: ["BTCUSDT"], fallback: false };
  if (cfg.pool === "btceth") return { list: ["BTCUSDT", "ETHUSDT"], fallback: false };
  const n = cfg.pool === "top100" ? 100 : 30;
  const list = await fetchTop();
  if (!list) return { list: FALLBACK_TOP.slice(0, n), fallback: true };
  return { list: list.slice(0, n), fallback: false };
}

function isInterval(v: string): v is Interval {
  return (IV_OK as string[]).includes(v);
}

export async function drawSession(cfg: Config): Promise<{ ok: true; drawn: Drawn; note?: string } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  const ivs = chosenIntervals(cfg);
  if (!ivs.length) return { ok: false, errors: ["没有勾选任何周期。"] };
  const pool = await symbolPool(cfg);
  const syms = pool.list;
  const note = pool.fallback ? "拿不到币安合约成交量排行，先用内置的主流列表" : undefined;
  if (!syms.length) return { ok: false, errors: ["交易对列表是空的。"] };
  const seen = recentDraws();
  let lastErr: Error | null = null;
  let shortHits = 0;
  let deadSyms = 0;
  const iv = ivs[0];
  for (let attempt = 0; attempt < 14; attempt++) {
    const ms = IV_MS[iv];
    const minSpan = (FIXED.ctxMin + FIXED.futMin) * ms;
    const cand = syms.filter((x) => fitsSpan(x, minSpan));
    if (!cand.length) {
      lastErr = new Error(`没有交易对的历史撑得起 ${iv}`);
      continue;
    }
    const sym = cand[(Math.random() * cand.length) | 0];
    try {
      const t0 = await firstBarTime(sym);
      if (t0 === null) {
        deadSyms++;
        continue;
      }
      const first = t0 != null ? t0 : Date.now() - FIXED.yearsBack * 365 * 864e5;
      const lo = Math.max(first + FIXED.ctxMin * ms, Date.now() - FIXED.yearsBack * 365 * 864e5);
      const hi = Date.now() - FIXED.futMin * ms - 864e5;
      if (!(hi > lo)) {
        shortHits++;
        lastErr = new Error(`${sym} ${iv} 的历史太短`);
        continue;
      }
      const D = Math.floor(lo + Math.random() * (hi - lo));
      const tag = drawTag(sym, ivs.join("+"), D);
      if (attempt < 8 && seen.includes(tag)) continue;
      const ctxN = Math.min(FIXED.ctxMax, Math.floor((D - first) / ms));
      const start = D - ctxN * ms;
      const bars = await fetchCrypto(sym, iv, start, ctxN + 500);
      const at = bars.findIndex((b) => b.t >= D);
      const ctx = Math.min(at < 0 ? bars.length : at, bars.length - 100);
      if (ctx >= FIXED.ctxMin) {
        pushRecent(tag);
        const frames = await loadFrames(sym, ivs.slice(1), bars[0].t);
        const missing = ivs.slice(1).filter((x) => !frames.some((f) => f.interval === x));
        const extra = missing.length ? `${missing.join("、")} 没拉到，这局少这几档` : undefined;
        const notes = [note, extra].filter(Boolean).join("。");
        return { ok: true, drawn: { symbol: sym, interval: iv, bars, ctx, frames }, note: notes || undefined };
      }
      shortHits++;
      lastErr = new Error(`${sym} ${iv}:只拿到 ${bars.length} 根`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const detail = (e as FeedErr).detail;
      if (detail?.length) errors.splice(0, errors.length, ...detail);
    }
  }
  if (!errors.length && lastErr) errors.push(String(lastErr.message || lastErr));
  if (deadSyms) errors.push(`${deadSyms} 次抽到的交易对拿不到 K 线（可能已下架）。`);
  if (shortHits) errors.push(`${shortHits} 次抽到的交易对历史太短，换个周期或交易对范围再试。`);
  return { ok: false, errors: errors.length ? errors : ["没有拉到真实行情。"] };
}
