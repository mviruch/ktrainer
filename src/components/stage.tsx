import { useEffect, useMemo, useState } from "react";
import { IV_CN, IV_OK, SPEED_OPTS } from "@/lib/constants";
import { buildChartModel } from "@/lib/chart-model";
import { ChartBar, ChartTools, type Tool } from "@/components/chart-tools";
import { PaneLegend } from "@/components/ind-window";
import { activeView, chartSlice, intervalList } from "@/lib/frames";
import { blindBaseOf } from "@/lib/format";
import { computeIndicators, defaultParams, defOf, type IndInst, type IndKind, type PaneBox, type Plot } from "@/lib/indicators";
import { loadInds, saveInds } from "@/lib/persist";
import type { Anchor, Drawing } from "@/lib/types";
import { canSkip } from "@/lib/engine";
import { useTrainer } from "@/state/trainer";
import { Button } from "@/components/ui/button";
import { KlineChart } from "@/components/kline-chart";

function speedLabel(v: number) {
  return `${+v.toFixed(2)} 秒/根`;
}

export function Transport() {
  const t = useTrainer();
  const on = t.phase === "trade";
  const opts = SPEED_OPTS.includes(t.speed) ? SPEED_OPTS : [...SPEED_OPTS, t.speed].sort((a, b) => a - b);
  const n = t.round ? t.round.cursor - t.round.ctx : 0;
  const count = !t.round
    ? ""
    : t.round.extending
      ? "正在往后续拉行情…"
      : t.round.done
        ? `本局走了 ${n} 根`
        : `第 ${n} 根${t.round ? " " + IV_CN[t.round.interval] : ""} · ${speedLabel(t.speed)}${t.playing ? " · 播放中" : ""}`;
  return (
    <div id="transport">
      <Button variant="primary" disabled={!on} className={t.playing ? "!border-chalk !bg-chalk !text-white" : ""} onClick={t.togglePlay}>
        {t.playing ? "❚❚ 暂停" : "▶ 播放"}
        <span className="key">Space</span>
      </Button>
      <Button disabled={!on} onClick={t.step}>
        下一根<span className="key">→</span>
      </Button>
      <select
        aria-label="播放速度"
        className="h-8 rounded-[3px] border border-line bg-raise px-2 text-[13px]"
        value={String(t.speed)}
        onChange={(e) => {
          if (e.target.value === "custom") t.openDialog({ kind: "speed" });
          else t.setSpeed(+e.target.value);
        }}
      >
        {opts.map((v) => (
          <option key={v} value={v}>
            {speedLabel(v)}
          </option>
        ))}
        <option value="custom">自定义…</option>
      </select>
      <Button disabled={!on} onClick={t.requestEnd}>
        结束本局
      </Button>
      <Button disabled={!canSkip(t.round)} onClick={t.abort} title="还没交易时可以换一段行情，不算局数">
        换一段
      </Button>
      <Button disabled={!(on || t.phase === "result") || t.peeking} onClick={t.requestPeek}>
        揭示 300 根
      </Button>
      <Button disabled={!t.round} onClick={t.fit}>
        适应<span className="key">F</span>
      </Button>
      <div id="barcount">{count}</div>
    </div>
  );
}

export function Stage() {
  const t = useTrainer();
  const round = t.round;
  const [tool, setTool] = useState<Tool>("cursor");
  const [pending, setPending] = useState<Anchor | null>(null);
  const [hover, setHover] = useState<Anchor | null>(null);
  const [inds, setInds] = useState<IndInst[]>(loadInds);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [boxes, setBoxes] = useState<PaneBox[]>([]);
  const [indError, setIndError] = useState("");
  const started = round?.startedAt ?? 0;
  const [epoch, setEpoch] = useState(started);
  if (epoch !== started) {
    setEpoch(started);
    setTool("cursor");
    setPending(null);
    setPlots([]);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape" && (pending || tool !== "cursor")) {
        setPending(null);
        setTool("cursor");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, tool]);
  const peekEnd = t.peekEnd;
  const greenUp = t.cfg.greenUp;
  const sig = round
    ? [
        round.startedAt,
        activeView(round),
        round.cursor,
        round.bars.length,
        round.done ? 1 : 0,
        round.wallet,
        round.fills.length,
        round.orders.map((o) => `${o.id}:${o.price}`).join(","),
        round.pos ? `${round.pos.qty}:${round.pos.entry}:${round.pos.tp}:${round.pos.sl}:${round.pos.margin}` : "",
        peekEnd ?? 0,
        greenUp ? 1 : 0,
      ].join("|")
    : "";
  const indKey = inds.map((s) => `${s.id}:${s.kind}:${JSON.stringify(s.params)}`).join("|");
  useEffect(() => {
    if (!round || !inds.length) return;
    let dead = false;
    const slice = chartSlice(round, peekEnd);
    const base = blindBaseOf(round.bars, round.ctx, round.done);
    computeIndicators(slice.bars.slice(0, slice.end), inds, base).then(
      (next) => {
        if (!dead) setPlots(next);
      },
      () => {
        if (!dead) setIndError("TA-Lib 没加载上");
      },
    );
    return () => {
      dead = true;
    };
    // round 就地改。sig 才是数据变了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, indKey]);
  const draft: Drawing | null =
    pending && hover && tool !== "cursor" && tool !== "hline" ? { id: 0, kind: tool, a: pending, b: hover } : null;
  const model = useMemo(
    () => (round ? buildChartModel(round, peekEnd, greenUp) : null),
    // round 就地改。sig 才是「数据变了」的信号，不能拿掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  const note = !round
    ? "标的与时间已屏蔽"
    : round.done
      ? `${round.symbol} · 已揭盲`
      : "标的、时间与价格轴已屏蔽 · 纵轴 = 开局那根收盘 100";
  const intervals = round ? intervalList(round) : IV_OK.filter((iv) => t.cfg.intervals.split(",").includes(iv));
  const commitInds = (next: IndInst[]) => {
    setInds(next);
    setIndError("");
    if (!next.length) setPlots([]);
    saveInds(next);
  };
  const addInd = (kind: IndKind) => {
    const def = defOf(kind);
    if (!def) return;
    const id = inds.reduce((max, inst) => Math.max(max, inst.id), 0) + 1;
    commitInds([...inds, { id, kind: def.kind, params: defaultParams(def) }]);
  };
  const onPanes = (next: PaneBox[]) => {
    setBoxes((prev) => {
      if (prev.length === next.length && prev.every((box, i) => box.pane === next[i].pane && box.top === next[i].top)) return prev;
      return next;
    });
  };
  return (
    <div id="stage">
      <div id="chartwrap">
        <ChartBar
          intervals={intervals}
          active={round ? activeView(round) : ""}
          note={note}
          inds={inds}
          indError={indError}
          onView={t.setView}
          onAdd={addInd}
        />
        <div id="chartbody">
        <ChartTools
          tool={tool}
          pending={!!pending}
          disabled={!round}
          onTool={(next) => {
            setTool(next);
            setPending(null);
          }}
          onUndo={t.undoDrawing}
          onClear={t.clearDrawings}
        />
        <KlineChart
          model={model}
          sessionKey={round?.startedAt ?? 0}
          peekKey={t.peekEnd ?? 0}
          cursor={round?.cursor ?? 0}
          viewKey={round ? activeView(round) : ""}
          greenUp={t.cfg.greenUp}
          priceBase={round ? blindBaseOf(round.bars, round.ctx, round.done) : null}
          drawings={round?.drawings ?? []}
          draft={draft}
          plots={plots}
          onPanes={onPanes}
          onPick={(anchor) => {
            if (!round || tool === "cursor") return;
            if (tool === "hline") {
              t.addDrawing({ id: 0, kind: "hline", price: anchor.price });
              return;
            }
            if (!pending) setPending(anchor);
            else {
              t.addDrawing({ id: 0, kind: tool, a: pending, b: anchor });
              setPending(null);
            }
          }}
          onHover={(anchor) => {
            if (!pending || tool === "cursor" || tool === "hline") {
              if (hover) setHover(null);
              return;
            }
            setHover(anchor);
          }}
          bindFit={t.bindFit}
        />
        <PaneLegend
          boxes={boxes}
          inds={inds}
          plots={plots}
          onChange={(id, key, value) => commitInds(inds.map((inst) => (inst.id === id ? { ...inst, params: { ...inst.params, [key]: value } } : inst)))}
          onRemove={(id) => commitInds(inds.filter((inst) => inst.id !== id))}
        />
        {t.phase === "empty" && (
          <div id="empty">
            <p>每一局随机抽一个币安合约和一段历史行情，屏蔽币种、日期和价格。K 线一根一根播放，你像在币安上一样开仓、加仓、平仓。</p>
            <Button variant="primary" onClick={t.start}>
              开始第一局
            </Button>
          </div>
        )}
        {t.phase === "error" && (
          <div id="empty">
            <p>没有拉到真实行情。下面是每个数据源的实际返回。这里不会用合成数据顶替。</p>
            <pre>{(t.errors.length ? t.errors : ["(没有记录到具体错误)"]).join("\n")}</pre>
            <p>币安在部分网络下需要代理才能打开。换个网络，或者在设置里把交易对换成 BTC 再试。</p>
            <Button variant="primary" onClick={t.retry}>
              重试
            </Button>
          </div>
        )}
        </div>
      </div>
      <Transport />
    </div>
  );
}
