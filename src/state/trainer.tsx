/* eslint-disable react-refresh/only-export-components, react-hooks/immutability */
import { useContext, useEffect, useMemo, useState, createContext, type ReactNode } from "react";
import { FIXED, IV_MS, LEV_MAX, SPEED_MAX, SPEED_MIN } from "@/lib/constants";
import {
  advance,
  canSkip,
  cancelOrder,
  closePct,
  flatten,
  maxOpen,
  newRound,
  placeOrder,
  reversePos,
  setPosTpSl,
} from "@/lib/engine";
import { clearDeadHosts, drawSession, fetchMore } from "@/lib/market";
import {
  clearRound,
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
  saveRound,
  saveRuns,
  toLog,
} from "@/lib/persist";
import { store } from "@/lib/store";
import { intervalList } from "@/lib/frames";
import type { ActResult, Config, Drawing, Interval, MarginMode, OrderDraft, OrderTab, Phase, Round, RoundLog, RunLog } from "@/lib/types";

export type DialogState =
  | null
  | { kind: "lev" }
  | { kind: "mode" }
  | { kind: "tpsl" }
  | { kind: "end" }
  | { kind: "peek" }
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
  dialog: DialogState;
  loadMsg: string;
  tok: number;
};

export type Trainer = Box & {
  rev: number;
  start: () => void;
  step: () => void;
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
  reverse: () => void;
  cancel: (id: number) => void;
  cancelAll: () => void;
  applyTpSl: (tp: number | null, sl: number | null) => void;
  setLev: (n: number) => void;
  setMode: (m: MarginMode) => void;
  setTab: (t: OrderTab) => void;
  setView: (iv: Interval) => void;
  addDrawing: (d: Drawing) => void;
  undoDrawing: () => void;
  clearDrawings: () => void;
  saveConfig: (c: Config) => void;
  resetWallet: () => ActResult;
  wipe: () => ActResult;
  openDialog: (d: Exclude<DialogState, null>) => void;
  closeDialog: () => void;
  toastMsg: (m: string, ms?: number) => void;
  retry: () => void;
  fit: () => void;
  bindFit: (fn: (() => void) | null) => void;
  maxLong: () => number;
};

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

  function endRound(reason: string) {
    const t = box.current.round;
    if (!t || t.done) return;
    box.current.playing = false;
    flatten(t, box.current.acc.lev, box.current.acc.mode, "结束");
    t.orders = [];
    t.done = true;
    const rec = toLog(t, reason);
    box.current.log = [...box.current.log, rec].slice(-600);
    saveLog(box.current.log);
    box.current.acc.wallet = t.wallet;
    let bust = false;
    if (box.current.acc.wallet < 1) {
      bust = true;
      box.current.acc.busts += 1;
      box.current.acc.wallet = FIXED.account;
    }
    box.current.acc.runN += 1;
    saveAccount(box.current.acc);
    clearRound();
    box.current.result = { rec, bust };
    box.current.phase = "result";
    box.current.dialog = null;
    const run = box.current.acc.runN >= FIXED.runSize ? closeRun() : null;
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

  function step() {
    const t = box.current.round;
    if (!t || t.done || box.current.phase !== "trade") return;
    if (t.cursor >= t.bars.length) {
      void pullMore(t);
      return;
    }
    const { toasts } = advance(t, box.current.acc.lev, box.current.acc.mode);
    saveSoon(false);
    if (t.bust) {
      if (toasts.length) toastMsg(toasts[toasts.length - 1], 4000);
      endRound("爆仓");
      return;
    }
    if (toasts.length) toastMsg(toasts[toasts.length - 1], 3500);
    else bump();
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
      const res = placeOrder(t, d, box.current.acc.mode);
      if (!res.ok) {
        toastMsg(res.error);
        return false;
      }
      saveSoon(true);
      if (res.info) toastMsg(res.info, 3200);
      else bump();
      return true;
    },
    closePart(f: number) {
      const t = box.current.round;
      if (!t || !t.pos) return;
      closePct(t, f, box.current.acc.lev, box.current.acc.mode);
      saveSoon(true);
      bump();
    },
    reverse() {
      const t = box.current.round;
      if (!t) return;
      const res = reversePos(t, box.current.acc.lev, box.current.acc.mode);
      if (!res.ok) {
        toastMsg(res.error);
        return;
      }
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
      t.orders = [];
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
      t.drawings = d.kind === "hline" ? [...t.drawings, { id, kind: "hline", price: d.price }] : [...t.drawings, { id, kind: d.kind, a: d.a, b: d.b }];
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
      toastMsg("已保存，下一局生效");
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
    if (!store.booted) {
      store.booted = true;
      const saved = loadRound();
      if (saved) {
        store.holder.current.round = saved;
        store.holder.current.phase = "trade";
        store.api.toastMsg("接着上次没打完的那一局", 2600);
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
    const timer = window.setInterval(() => store.api.step(), Math.round(s.speed * 1000));
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
      dialog: s.dialog,
      loadMsg: s.loadMsg,
      tok: s.tok,
      ...store.api,
    }),
    [rev, s, store],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
