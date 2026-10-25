/* eslint-disable react-refresh/only-export-components, react-hooks/immutability */
import { useContext, useEffect, useMemo, useState, createContext, type ReactNode } from "react";
import { FILL_CAP, FIXED, IV_MS, LEV_MAX, SPEED_MAX, SPEED_MIN } from "@/lib/constants";
import {
  advance,
  canSkip,
  cancelAll as cancelAllOrders,
  cancelOrder,
  closePct,
  finishRound,
  maxOpen,
  newRound,
  placeOrder,
  reversePos,
  setPosTpSl,
} from "@/lib/engine";
import { clearDeadHosts, drawSession, fetchMore, revealWindow } from "@/lib/market";
import {
  clearRound,
  findSettledRound,
  loadAccount,
  loadConfig,
  loadLog,
  loadRound,
  loadRuns,
  loadSpeed,
  loadTab,
  saveAccount,
  saveConfig as writeCfg,
  saveLog,
  clearReviews,
  loadReviews,
  saveReview,
  saveRound,
  saveRuns,
  toLog,
} from "@/lib/persist";
import { onStoreFail, store } from "@/lib/store";
import { toReview } from "@/lib/review-store";
import { attachSnaps, memorySnapStore, saveSnaps, SNAP_KEEP, snapSig, type SnapRec, type SnapStore } from "@/lib/snap-store";
import { buildReviewExport, reviewFiles } from "@/lib/export-review";
import { zipFiles } from "@/lib/zip";
import { playFillSound } from "@/lib/fill-sound";
import { download } from "@/lib/stats";
import { idbSnapStore } from "@/state/idb-snaps";
import { activeView, bucketOpen, intervalList } from "@/lib/frames";
import type { ActResult, CaptureIn, Config, Drawing, Interval, MarginMode, OrderDraft, OrderTab, Phase, Round, RoundLog, RunLog } from "@/lib/types";

export type DialogState =
  | null
  | { kind: "lev" }
  | { kind: "mode" }
  | { kind: "tpsl" }
  | { kind: "end" }
  | { kind: "peek" }
  | { kind: "reverse" }
  | { kind: "speed" }
  | { kind: "wipe" }
  | { kind: "reset" }
  | { kind: "run"; run: RunLog };

type Box = {
  cfg: Config;
  acc: ReturnType<typeof loadAccount>;
  log: RoundLog[];
  runs: RunLog[];
  round: Round | null;
  phase: Phase;
  errors: string[];
  playing: boolean;
  speed: number;
  tab: OrderTab;
  toast: string | null;
  result: { rec: RoundLog; bust: boolean } | null;
  peekEnd: number | null;
  peeking: boolean;
  /** Identity reveal after settle: loading → ok | fail (with message). */
  reveal: { status: "loading" | "ok" | "fail"; error?: string } | null;
  dialog: DialogState;
  loadMsg: string;
  tok: number;
};

export type Trainer = Box & {
  rev: number;
  start: () => void;
  step: () => void;
  tick: () => void;
  togglePlay: () => void;
  setSpeed: (v: number) => void;
  requestEnd: () => void;
  confirmEnd: () => void;
  abort: () => void;
  requestPeek: () => void;
  confirmPeek: () => void;
  next: () => void;
  place: (d: OrderDraft) => boolean;
  closePart: (f: number) => void;
  requestReverse: () => void;
  confirmReverse: () => void;
  cancel: (id: number) => void;
  cancelAll: () => void;
  applyTpSl: (tp: number | null, sl: number | null) => void;
  setLev: (n: number) => void;
  setMode: (m: MarginMode) => void;
  setTab: (t: OrderTab) => void;
  setView: (iv: Interval) => void;
  addDrawing: (d: Drawing) => void;
  updateDrawing: (d: Drawing) => void;
  removeDrawing: (id: number) => void;
  undoDrawing: () => void;
  clearDrawings: () => void;
  saveConfig: (c: Config) => void;
  resetWallet: () => ActResult;
  wipe: () => ActResult;
  openDialog: (d: Exclude<DialogState, null>) => void;
  closeDialog: () => void;
  toastMsg: (m: string, ms?: number) => void;
  retry: () => void;
  retryReveal: () => void;
  fit: () => void;
  bindFit: (fn: (() => void) | null) => void;
  maxLong: () => number;
  /** Shell → core: indicators currently on the chart, snapshotted at order time. */
  setInds: (rows: CaptureIn["inds"]) => void;
  /** After a refresh-restore: read this round's snapshots back from IndexedDB. */
  restoreSnaps: (t: Round) => Promise<number>;
  /** Toast for a failed write (throttled per kind); wired to store.ts by the provider. */
  warnFail: (kind: string) => void;
  /** 「复盘详细导出」: JSON + flat CSV for rounds that have a fut-review record. */
  exportReview: () => Promise<boolean>;
};

/** What each failed write loses; shown once per kind per FAIL_GAP. */
const FAIL_MSG: Record<string, string> = {
  "fut-log": "浏览器存储已满：本局成绩没存上，刷新后会丢。建议先到统计里导出 CSV / JSON",
  "fut-round": "浏览器存储已满：进行中的这一局没存上，刷新会丢掉进度",
  "fut-review": "浏览器存储已满：复盘详情（成交明细、委托事件、持仓统计、画线）没存上，刷新后会丢。建议先导出",
  "fut-acc": "浏览器存储已满：账户余额没存上，刷新后会回到上次保存的余额",
  "fut-runs": "浏览器存储已满：轮次统计没存上，刷新后会丢。建议先导出",
  snaps: "K 线快照没存进 IndexedDB，刷新后本局下单快照会丢。建议先导出",
};
const FAIL_GAP = 30_000;

const Ctx = createContext<Trainer | null>(null);

export function useTrainer() {
  const v = useContext(Ctx);
  if (!v) throw new Error("缺少训练上下文");
  return v;
}

function createBox(): Box {
  return {
    cfg: loadConfig(),
    acc: loadAccount(),
    log: loadLog(),
    runs: loadRuns(),
    round: null,
    phase: "empty",
    errors: [],
    playing: false,
    speed: loadSpeed(),
    tab: loadTab(),
    toast: null,
    result: null,
    peekEnd: null,
    peeking: false,
    reveal: null,
    dialog: null,
    loadMsg: "",
    tok: 0,
  };
}

function createApi(box: { current: Box }, bump: () => void) {
  let toastSeq = 0;
  let saveTimer = 0;
  let saveAt = 0;
  let fitChart: (() => void) | null = null;
  let curInds: CaptureIn["inds"] = [];
  const failAt: Record<string, number> = {};
  function warnFail(kind: string) {
    const now = Date.now();
    if (failAt[kind] && now - failAt[kind] < FAIL_GAP) return;
    failAt[kind] = now;
    toastMsg(FAIL_MSG[kind] ?? `浏览器存储已满：设置（${kind}）没存上，刷新后会丢`, 5000);
  }
  let snapStore: SnapStore;
  try {
    snapStore = typeof indexedDB !== "undefined" ? idbSnapStore() : memorySnapStore();
  } catch {
    snapStore = memorySnapStore();
  }
  let snapWritten = "";
  /** Serialises IndexedDB work so a write never races the refresh-restore read (which would drop old snaps). */
  let snapChain: Promise<unknown> = Promise.resolve();
  function persistSnaps(t: Round) {
    snapChain = snapChain.then(async () => {
      const sig = snapSig(t);
      if (sig === snapWritten) return;
      try {
        await saveSnaps(snapStore, t);
        snapWritten = sig;
      } catch {
        warnFail("snaps");
      }
    });
  }
  const cap = (t: Round): CaptureIn => ({ view: activeView(t), inds: curInds, drawings: t.drawings });

  let suppressFillSound = false;

  function fillCount() {
    return box.current.round?.fills.length ?? 0;
  }

  function onNewFills(before: number) {
    if (suppressFillSound || box.current.cfg.fillSound === false) return;
    const t = box.current.round;
    if (!t || t.fills.length <= before) return;
    playFillSound();
  }

  function toastMsg(msg: string, ms = 2000) {
    const id = ++toastSeq;
    box.current.toast = msg;
    window.setTimeout(() => {
      if (toastSeq !== id) return;
      box.current.toast = null;
      bump();
    }, ms);
    bump();
  }

  function saveSoon(now = false) {
    const write = () => {
      saveTimer = 0;
      saveAt = Date.now();
      const t = box.current.round;
      if (!t || t.done) return;
      saveRound(t);
      persistSnaps(t);
    };
    if (now) {
      window.clearTimeout(saveTimer);
      write();
      return;
    }
    if (!saveTimer) saveTimer = window.setTimeout(write, Math.max(0, 2000 - (Date.now() - saveAt)));
  }

  function closeRun(): RunLog | null {
    const n = box.current.acc.runN;
    if (!n) return null;
    const rows = box.current.log.slice(-n);
    if (!rows.length) return null;
    const traded = rows.filter((r) => r.fills > 0);
    const wins = traded.filter((r) => r.pnl > 0);
    const run: RunLog = {
      idx: box.current.runs.length + 1,
      ts: Date.now(),
      n,
      pnl: +rows.reduce((a, r) => a + r.pnl, 0).toFixed(2),
      fees: +rows.reduce((a, r) => a + r.fees, 0).toFixed(2),
      traded: traded.length,
      wins: wins.length,
      liqs: rows.reduce((a, r) => a + (r.liqs || 0), 0),
      startW: rows[0].startW,
      endW: rows[rows.length - 1].endW,
      best: Math.max(...rows.map((r) => r.pnl)),
      worst: Math.min(...rows.map((r) => r.pnl)),
    };
    box.current.runs = [...box.current.runs, run];
    saveRuns(box.current.runs);
    box.current.acc.runN = 0;
    saveAccount(box.current.acc);
    return run;
  }

  function cancelSave() {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
  }

  function endRound(reason: string) {
    const t = box.current.round;
    if (!t || t.done) return;
    // Stop any debounced autosave so a stale write cannot resurrect this round after clearRound.
    cancelSave();
    box.current.playing = false;
    suppressFillSound = true;
    finishRound(t, box.current.acc.lev, box.current.acc.mode);
    suppressFillSound = false;
    t.done = true;
    persistSnaps(t);
    // Drop in-progress draft immediately — refresh must not restore an open position from an ended round.
    clearRound();

    const prior = findSettledRound(box.current.log, t);
    let rec: RoundLog;
    let bust = false;
    if (prior) {
      // Idempotent: same startedAt already contributed to session/account stats.
      rec = prior;
    } else {
      rec = toLog(t, reason);
      const review = toReview(t);
      saveReview(review);
      if (review.fillsCut) toastMsg(`本局成交超过 ${FILL_CAP} 笔，复盘记录只保留前 ${FILL_CAP} 笔`, 4000);
      box.current.log = [...box.current.log, rec].slice(-600);
      saveLog(box.current.log);
      box.current.acc.wallet = t.wallet;
      if (box.current.acc.wallet < 1) {
        bust = true;
        box.current.acc.busts += 1;
        box.current.acc.wallet = FIXED.account;
      }
      box.current.acc.runN += 1;
      saveAccount(box.current.acc);
    }

    box.current.result = { rec, bust };
    box.current.phase = "result";
    box.current.dialog = null;
    // Settle first (stats already written above, idempotent), then auto-reveal identity.
    void revealIdentity();
    const run = !prior && box.current.acc.runN >= FIXED.runSize ? closeRun() : null;
    bump();
    if (run) {
      window.setTimeout(() => {
        if (!box.current.dialog) box.current.dialog = { kind: "run", run };
        bump();
      }, 300);
    }
  }

  async function pullMore(t: Round) {
    if (t.extending) return;
    t.extending = true;
    const was = box.current.playing;
    box.current.playing = false;
    bump();
    const last = t.bars[t.bars.length - 1];
    const more = await fetchMore(t.symbol, t.interval, last.t + (IV_MS[t.interval] || 36e5));
    t.extending = false;
    if (box.current.round !== t || t.done) return;
    if (!more?.length) {
      toastMsg("后面没有行情了，点「结束本局」结算", 4000);
      return;
    }
    t.bars = t.bars.concat(more);
    saveSoon(false);
    if (was) box.current.playing = true;
    bump();
  }

  /* 播放用：每次走一根基础周期 K 线。 */
  function tick() {
    const t = box.current.round;
    if (!t || t.done || box.current.phase !== "trade") return;
    if (t.cursor >= t.bars.length) {
      void pullMore(t);
      return;
    }
    const fillsBefore = fillCount();
    const { toasts } = advance(t, box.current.acc.lev, box.current.acc.mode);
    onNewFills(fillsBefore);
    saveSoon(false);
    if (t.bust) {
      if (toasts.length) toastMsg(toasts[toasts.length - 1], 4000);
      endRound("爆仓");
      return;
    }
    if (toasts.length) toastMsg(toasts[toasts.length - 1], 3500);
    else bump();
  }

  /* 「下一根」：按当前看的周期走一整根。视图是 1H、基础是 5m 时，一次走到下一个 1H 收盘；
     中途逐根撮合，爆仓/成交提示照常，K 线不够就去续拉并停在这里。 */
  function step() {
    const t = box.current.round;
    if (!t || t.done || box.current.phase !== "trade") return;
    const view = activeView(t);
    const baseMs = IV_MS[t.interval] || 36e5;
    const viewMs = IV_MS[view] || baseMs;
    if (view === t.interval || viewMs <= baseMs) {
      tick();
      return;
    }
    const toasts: string[] = [];
    let moved = 0;
    const fillsBefore = fillCount();
    while (true) {
      if (t.cursor >= t.bars.length) {
        if (moved) {
          onNewFills(fillsBefore);
          saveSoon(false);
        }
        if (toasts.length) toastMsg(toasts[toasts.length - 1], 3500);
        void pullMore(t);
        return;
      }
      const r = advance(t, box.current.acc.lev, box.current.acc.mode);
      moved++;
      toasts.push(...r.toasts);
      if (t.bust) {
        saveSoon(false);
        if (toasts.length) toastMsg(toasts[toasts.length - 1], 4000);
        endRound("爆仓");
        return;
      }
      const now = t.bars[t.cursor - 1].t + baseMs;
      if (bucketOpen(now, viewMs) === now || moved > 5000) break;
    }
    onNewFills(fillsBefore);
    saveSoon(false);
    if (toasts.length) toastMsg(toasts[toasts.length - 1], 3500);
    else bump();
  }

  async function revealIdentity() {
    const t = box.current.round;
    if (!t || !t.done || t.revealed) return;
    box.current.reveal = { status: "loading" };
    bump();
    try {
      await revealWindow(t.symbol, t.interval, t.bars[t.ctx]?.t ?? NaN);
      if (box.current.round !== t) return;
      t.revealed = true;
      box.current.reveal = { status: "ok" };
      // Mark the settled log row so CSV may export the real symbol for this round only.
      const rec = box.current.result?.rec;
      if (rec && !rec.revealed) {
        rec.revealed = true;
        box.current.log = box.current.log.map((r) => (r === rec || (rec.startedAt != null && r.startedAt === rec.startedAt) ? { ...r, revealed: true } : r));
        saveLog(box.current.log);
      }
    } catch (e) {
      if (box.current.round !== t) return;
      box.current.reveal = { status: "fail", error: e instanceof Error ? e.message : "揭盲失败" };
    }
    bump();
  }

  async function revealPeek() {
    const t = box.current.round;
    if (!t) return;
    box.current.peeking = true;
    bump();
    let guard = 0;
    while (t.bars.length - t.cursor < FIXED.peekBars && guard++ < 8) {
      const last = t.bars[t.bars.length - 1];
      const more = await fetchMore(t.symbol, t.interval, last.t + (IV_MS[t.interval] || 36e5), 500);
      if (box.current.round !== t) return;
      if (!more?.length) break;
      t.bars = t.bars.concat(more);
    }
    box.current.peeking = false;
    if (box.current.round !== t) return;
    const n = Math.min(FIXED.peekBars, t.bars.length - t.cursor);
    if (n < 5) {
      toastMsg("后面没有行情可以揭示了");
      return;
    }
    box.current.peekEnd = t.cursor + n;
    bump();
  }

  async function start() {
    const tok = ++box.current.tok;
    box.current.playing = false;
    box.current.phase = "loading";
    box.current.loadMsg = "正在随机抽取标的与时间段…";
    box.current.round = null;
    box.current.result = null;
    box.current.peekEnd = null;
    box.current.reveal = null;
    box.current.errors = [];
    box.current.dialog = null;
    bump();
    const drawn = await drawSession(box.current.cfg);
    if (tok !== box.current.tok) return;
    if (!drawn.ok) {
      box.current.phase = "error";
      box.current.errors = drawn.errors;
      box.current.loadMsg = "拿不到行情";
      bump();
      return;
    }
    const t = newRound(drawn.drawn, box.current.acc.wallet);
    box.current.round = t;
    box.current.phase = "trade";
    saveRound(t);
    if (drawn.note) toastMsg(drawn.note, 3500);
    else bump();
  }

  function locked() {
    const t = box.current.round;
    return !!t && !t.done && (!!t.pos || t.orders.length > 0);
  }

  return {
    start: () => void start(),
    step,
    tick,
    togglePlay() {
      const t = box.current.round;
      if (!t || t.done || box.current.phase !== "trade") return;
      box.current.playing = !box.current.playing;
      bump();
    },
    setSpeed(v: number) {
      const s = Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
      box.current.speed = s;
      store.set("fut-speed", s);
      bump();
    },
    requestEnd() {
      const t = box.current.round;
      if (!t || t.done) return;
      box.current.playing = false;
      if (!t.pos && !t.orders.length) {
        endRound(t.fills.length ? "手动结束" : "观望");
        return;
      }
      box.current.dialog = { kind: "end" };
      bump();
    },
    confirmEnd() {
      box.current.dialog = null;
      endRound("手动结束");
    },
    abort() {
      if (!canSkip(box.current.round)) {
        toastMsg("这一局已经有交易了，只能结束本局");
        return;
      }
      box.current.playing = false;
      cancelSave();
      clearRound();
      void start();
    },
    requestPeek() {
      const t = box.current.round;
      if (!t) return;
      if (!t.done) {
        box.current.playing = false;
        box.current.dialog = { kind: "peek" };
        bump();
        return;
      }
      void revealPeek();
    },
    confirmPeek() {
      const t = box.current.round;
      if (t && !t.done) {
        t.peeked = true;
        box.current.dialog = null;
        endRound("揭示答案");
      }
      void revealPeek();
    },
    next: () => void start(),
    place(d: OrderDraft) {
      const t = box.current.round;
      if (!t || t.done) return false;
      const fillsBefore = fillCount();
      const res = placeOrder(t, d, box.current.acc.mode, cap(t));
      if (!res.ok) {
        toastMsg(res.error);
        return false;
      }
      onNewFills(fillsBefore);
      saveSoon(true);
      if (res.info) toastMsg(res.info, 3200);
      else bump();
      return true;
    },
    closePart(f: number) {
      const t = box.current.round;
      if (!t || !t.pos) return;
      const fillsBefore = fillCount();
      closePct(t, f, box.current.acc.lev, box.current.acc.mode, cap(t));
      onNewFills(fillsBefore);
      saveSoon(true);
      bump();
    },
    requestReverse() {
      const t = box.current.round;
      if (!t || !t.pos) return;
      box.current.playing = false;
      box.current.dialog = { kind: "reverse" };
      bump();
    },
    confirmReverse() {
      const t = box.current.round;
      box.current.dialog = null;
      if (!t) {
        bump();
        return;
      }
      const fillsBefore = fillCount();
      const res = reversePos(t, box.current.acc.lev, box.current.acc.mode, cap(t));
      if (!res.ok) {
        toastMsg(res.error);
        bump();
        return;
      }
      onNewFills(fillsBefore);
      saveSoon(true);
      bump();
    },
    cancel(id: number) {
      const t = box.current.round;
      if (!t) return;
      cancelOrder(t, id);
      saveSoon(true);
      bump();
    },
    cancelAll() {
      const t = box.current.round;
      if (!t) return;
      cancelAllOrders(t);
      saveSoon(true);
      bump();
    },
    applyTpSl(tp: number | null, sl: number | null) {
      const t = box.current.round;
      if (!t) return;
      const res = setPosTpSl(t, tp, sl);
      if (!res.ok) {
        toastMsg(res.error, 3000);
        return;
      }
      box.current.dialog = null;
      saveSoon(true);
      bump();
    },
    setLev(n: number) {
      if (locked()) {
        toastMsg("有持仓或挂单时不能调杠杆，先平仓撤单", 3000);
        return;
      }
      box.current.acc.lev = Math.max(1, Math.min(LEV_MAX, Math.round(n)));
      saveAccount(box.current.acc);
      box.current.dialog = null;
      bump();
    },
    setMode(m: MarginMode) {
      if (locked()) {
        toastMsg("有持仓或挂单时不能切换全仓 / 逐仓", 3000);
        return;
      }
      box.current.acc.mode = m;
      saveAccount(box.current.acc);
      box.current.dialog = null;
      bump();
    },
    setTab(tab: OrderTab) {
      box.current.tab = tab;
      store.set("fut-tab", tab);
      bump();
    },
    setView(iv: Interval) {
      const t = box.current.round;
      if (!t || !intervalList(t).includes(iv)) return;
      t.view = iv;
      saveSoon(false);
      bump();
    },
    addDrawing(d: Drawing) {
      const t = box.current.round;
      if (!t) return;
      if (!t.drawings) t.drawings = [];
      const id = t.drawings.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      let next: Drawing;
      if (d.kind === "hline") next = { id, kind: "hline", price: d.price, ...(d.style ? { style: d.style } : {}) };
      else if (d.kind === "channel") next = { id, kind: "channel", a: d.a, b: d.b, c: d.c, ...(d.style ? { style: d.style } : {}) };
      else next = { id, kind: d.kind, a: d.a, b: d.b, ...(d.style ? { style: d.style } : {}) };
      t.drawings = [...t.drawings, next];
      saveSoon(false);
      bump();
    },
    updateDrawing(d: Drawing) {
      const t = box.current.round;
      if (!t?.drawings.length) return;
      const i = t.drawings.findIndex((x) => x.id === d.id);
      if (i < 0) return;
      t.drawings = t.drawings.map((x) => (x.id === d.id ? d : x));
      saveSoon(false);
      bump();
    },
    removeDrawing(id: number) {
      const t = box.current.round;
      if (!t?.drawings.length) return;
      const next = t.drawings.filter((x) => x.id !== id);
      if (next.length === t.drawings.length) return;
      t.drawings = next;
      saveSoon(false);
      bump();
    },
    undoDrawing() {
      const t = box.current.round;
      if (!t?.drawings.length) return;
      t.drawings = t.drawings.slice(0, -1);
      saveSoon(false);
      bump();
    },
    clearDrawings() {
      const t = box.current.round;
      if (!t?.drawings.length) return;
      t.drawings = [];
      saveSoon(false);
      bump();
    },
    saveConfig(c: Config) {
      box.current.cfg = c;
      writeCfg(c);
      // pool/intervals 开新局才用；配色 / 成交音 / BE 线读当前 cfg，当局立刻生效。
      bump();
      toastMsg("已保存。交易对和周期下一局生效");
    },
    resetWallet() {
      const t = box.current.round;
      if (t && !t.done && (t.pos || t.orders.length || t.fills.length))
        return { ok: false as const, error: "这一局已经有交易，先结束本局再重置" };
      box.current.acc.wallet = FIXED.account;
      saveAccount(box.current.acc);
      if (t && !t.done) {
        t.wallet = t.startWallet = t.peakEq = box.current.acc.wallet;
        saveRound(t);
      }
      box.current.dialog = null;
      toastMsg("余额已重置为 10,000 U");
      return { ok: true as const };
    },
    wipe() {
      const t = box.current.round;
      if (t && !t.done && (t.pos || t.orders.length))
        return { ok: false as const, error: "先结束本局再清空" };
      box.current.log = [];
      box.current.runs = [];
      box.current.acc.wallet = FIXED.account;
      box.current.acc.busts = 0;
      box.current.acc.runN = 0;
      saveLog([]);
      saveRuns([]);
      clearReviews();
      snapWritten = "";
      snapChain = snapChain.then(() => snapStore.clear()).catch(() => toastMsg("K 线快照没能从 IndexedDB 清掉，可以稍后再清一次", 4000));
      saveAccount(box.current.acc);
      if (t && !t.done) {
        t.wallet = t.startWallet = t.peakEq = box.current.acc.wallet;
        saveRound(t);
      }
      box.current.dialog = null;
      toastMsg("已清空");
      return { ok: true as const };
    },
    openDialog(d: Exclude<DialogState, null>) {
      box.current.dialog = d;
      bump();
    },
    closeDialog() {
      box.current.dialog = null;
      bump();
    },
    toastMsg,
    retryReveal() {
      // A failed reveal marks hosts dead; a manual retry should really hit the network again.
      clearDeadHosts();
      void revealIdentity();
    },
    retry() {
      clearDeadHosts();
      void start();
    },
    fit() {
      fitChart?.();
    },
    bindFit(fn: (() => void) | null) {
      fitChart = fn;
    },
    maxLong() {
      const t = box.current.round;
      if (!t || t.done) return 0;
      return maxOpen(t, 1, box.current.acc.lev);
    },
    setInds(rows: CaptureIn["inds"]) {
      curInds = rows ?? [];
    },
    warnFail,
    async exportReview() {
      const log = box.current.log;
      const reviews = loadReviews().filter((r) => log.some((l) => l.startedAt === r.startedAt));
      if (!reviews.length) {
        toastMsg("还没有可导出的局：复盘详情只记录这个版本之后打完的局", 3500);
        return false;
      }
      const recs = new Map<number, SnapRec>();
      let keys: number[] = [];
      try {
        await snapChain; // let pending snapshot writes land first
        keys = await snapStore.keys();
        for (const r of reviews) {
          if (!keys.includes(r.startedAt)) continue;
          const rec = await snapStore.get(r.startedAt);
          if (rec) recs.set(r.startedAt, rec);
        }
      } catch {
        toastMsg("读取 K 线快照失败，这次导出里的快照会是空的", 4000);
      }
      const x = buildReviewExport(log, reviews, { recs, keys, keep: SNAP_KEEP });
      // One zip (JSON + fills CSV + rounds CSV): browsers often block or prompt on several downloads in a row.
      download("合约训练复盘.zip", zipFiles(reviewFiles(x)) as Uint8Array<ArrayBuffer>, "application/zip");
      toastMsg(`已导出 ${x.rounds.length} 局复盘（zip：JSON + 成交 CSV + 局汇总 CSV）`, 2600);
      return true;
    },
    restoreSnaps(t: Round) {
      const job = snapChain.then(async () => {
        try {
          const n = attachSnaps(t, await snapStore.get(t.startedAt));
          snapWritten = snapSig(t);
          if (n) bump();
          return n;
        } catch {
          toastMsg("读取 K 线快照失败，本局之前的下单快照这次看不到", 4000);
          return 0;
        }
      });
      snapChain = job;
      return job;
    },
  };
}

export function TrainerProvider({ children }: { children: ReactNode }) {
  const [rev, setRev] = useState(0);
  const [store] = useState(() => {
    const holder = { current: createBox() };
    const api = createApi(holder, () => setRev((n) => n + 1));
    return { holder, api, booted: false };
  });

  useEffect(() => {
    // Registered here (not in createApi): StrictMode builds createApi twice and keeps only one.
    onStoreFail((k) => store.api.warnFail(k));
    return () => onStoreFail(null);
  }, [store]);

  useEffect(() => {
    if (!store.booted) {
      store.booted = true;
      const saved = loadRound();
      if (saved) {
        // Ended rounds must never resume with a live position; wipe dirty draft if already settled.
        if (findSettledRound(store.holder.current.log, saved)) {
          clearRound();
          if (store.holder.current.log.length) store.api.start();
        } else {
          store.holder.current.round = saved;
          store.holder.current.phase = "trade";
          store.api.toastMsg("接着上次没打完的那一局", 2600);
          void store.api.restoreSnaps(saved);
        }
      } else if (store.holder.current.log.length) store.api.start();
    }
    const onLeave = () => {
      const t = store.holder.current.round;
      if (t && !t.done) saveRound(t);
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [store]);

  const s = store.holder.current;
  useEffect(() => {
    if (!s.playing) return;
    const timer = window.setInterval(() => store.api.tick(), Math.round(s.speed * 1000));
    return () => window.clearInterval(timer);
  }, [s.playing, s.speed, store]);

  const value = useMemo<Trainer>(
    () => ({
      rev,
      cfg: s.cfg,
      acc: s.acc,
      log: s.log,
      runs: s.runs,
      round: s.round,
      phase: s.phase,
      errors: s.errors,
      playing: s.playing,
      speed: s.speed,
      tab: s.tab,
      toast: s.toast,
      result: s.result,
      peekEnd: s.peekEnd,
      peeking: s.peeking,
      reveal: s.reveal,
      dialog: s.dialog,
      loadMsg: s.loadMsg,
      tok: s.tok,
      ...store.api,
    }),
    [rev, s, store],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
