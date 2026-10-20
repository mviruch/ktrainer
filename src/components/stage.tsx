import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Maximize2, Pause, Play, RefreshCw, SkipForward } from "lucide-react";
import { IV_CN, IV_OK } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildChartModel } from "@/lib/chart-model";
import { ChartBar, ChartTools, type IndReadout, type Ohlc, type Tool } from "@/components/chart-tools";
import { PaneLegend } from "@/components/ind-window";
import { activeView, chartSlice, intervalList } from "@/lib/frames";
import { blindBaseOf } from "@/lib/format";
import { computeIndicators, defaultParams, defaultStyle, defOf, indColor, indTitle, instPane, plotValueAt, slotLabel, styleOf, type IndInst, type IndKind, type PaneBox, type Plot } from "@/lib/indicators";
import { loadInds, saveInds } from "@/lib/persist";
import { DEFAULT_CHANNEL_STYLE, type Anchor, type Drawing, type DrawStyle } from "@/lib/types";
import { canSkip } from "@/lib/engine";
import { useTrainer } from "@/state/trainer";
import { Button } from "@/components/ui/button";
import { KlineChart } from "@/components/kline-chart";
import { IndSettingsDialog } from "@/components/ind-settings";
import { DrawStyleDialog } from "@/components/draw-style";

function speedLabel(v: number) {
  return `${+v.toFixed(2)} 秒/根`;
}

const SPEED_PRESETS = [3, 5, 10];

function Kbd({ children }: { children: string }) {
  return <Badge variant="kbd">{children}</Badge>;
}

export function Transport() {
  const t = useTrainer();
  const on = t.phase === "trade";
  const baseIv = t.round?.interval ?? null;
  const viewIv = t.round ? activeView(t.round) : null;
  const n = t.round ? t.round.cursor - t.round.ctx : 0;
  const barLabel = (() => {
    if (!baseIv) return "";
    const base = IV_CN[baseIv];
    if (viewIv && viewIv !== baseIv) return `第 ${n} 根 · ${base}视图切到 ${IV_CN[viewIv]}`;
    return `第 ${n} 根 · ${base}`;
  })();
  const count = !t.round
    ? ""
    : t.round.extending
      ? "正在往后续拉行情…"
      : t.round.done
        ? `本局走了 ${n} 根`
        : `${barLabel} · ${speedLabel(t.speed)}${t.playing ? " · 播放中" : ""}`;
  const preset = SPEED_PRESETS.includes(t.speed) ? String(t.speed) : "custom";
  const skipOk = canSkip(t.round);
  return (
    <div id="transport" className="flex h-11 shrink-0 items-center gap-2 border-t border-line bg-panel px-3">
      <Button variant="primary" size="sm" disabled={!on} onClick={t.togglePlay} className="min-w-[78px]">
        {t.playing ? <Pause /> : <Play />}
        {t.playing ? "暂停" : "播放"}
        <Kbd>空格</Kbd>
      </Button>
      <Button size="sm" disabled={!on} onClick={t.step} title="按当前视图周期走一根">
        <SkipForward />
        下一根
        <Kbd>→</Kbd>
      </Button>
      <div className={`flex h-7 items-center gap-0.5 rounded-[4px] bg-ink px-1 ${on ? "" : "opacity-40"}`}>
        <span className="px-1 text-[11px] text-fg-3">速度</span>
        <ToggleGroup
          type="single"
          value={preset}
          disabled={!on}
          aria-label="播放速度"
          onValueChange={(v) => {
            if (!v) return;
            if (v === "custom") t.openDialog({ kind: "speed" });
            else t.setSpeed(+v);
          }}
        >
          {SPEED_PRESETS.map((v) => (
            <ToggleGroupItem key={v} value={String(v)} className="num text-[11px]">
              {v}s
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value="custom" className="text-[11px]" onClick={() => preset === "custom" && t.openDialog({ kind: "speed" })}>
            {preset === "custom" ? `${+t.speed.toFixed(2)}s` : "自定义…"}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Separator orientation="vertical" className="!h-5 shrink-0" />
      <Button variant="danger" size="sm" disabled={!on} onClick={t.requestEnd}>
        结束本局
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={skipOk ? -1 : 0}>
            <Button size="sm" disabled={!skipOk} onClick={t.abort}>
              <RefreshCw />
              换一段
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{skipOk ? "还没交易时可以换一段行情，不算局数" : "已经交易过，这一局不能换了"}</TooltipContent>
      </Tooltip>
      <Button size="sm" disabled={!(on || t.phase === "result") || t.peeking} onClick={t.requestPeek}>
        <Eye />
        揭示 300 根
      </Button>
      <Button size="sm" disabled={!t.round} onClick={t.fit}>
        <Maximize2 />
        适应
        <Kbd>F</Kbd>
      </Button>
      <div id="barcount" className="num ml-auto flex min-w-0 items-center gap-1.5 truncate text-[11px] text-fg-2">
        {count && <span className={`size-1.5 shrink-0 rounded-full ${t.playing ? "bg-up" : "bg-fg-3"}`} />}
        <span className="truncate">{count}</span>
      </div>
    </div>
  );
}

export function Stage() {
  const t = useTrainer();
  const round = t.round;
  const [tool, setTool] = useState<Tool>("cursor");
  /** Two-point tools store only `a`; channel stores `a` then `a+b` before the width click. */
  const [pending, setPending] = useState<{ a: Anchor; b?: Anchor } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [hover, setHover] = useState<Anchor | null>(null);
  /** Candle time under crosshair; null → header falls back to latest live bar. */
  const [hoverBarTime, setHoverBarTime] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [styleId, setStyleId] = useState<number | null>(null);
  const [inds, setInds] = useState<IndInst[]>(loadInds);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [boxes, setBoxes] = useState<PaneBox[]>([]);
  const [indError, setIndError] = useState("");
  const [maxPane, setMaxPane] = useState<string | null>(null);
  const [setting, setSetting] = useState<number | null>(null);
  const started = round?.startedAt ?? 0;
  const [epoch, setEpoch] = useState(started);
  if (epoch !== started) {
    setEpoch(started);
    setTool("cursor");
    setPending(null);
    setHoverBarTime(null);
    setSelectedId(null);
    setStyleId(null);
    setPlots([]);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape" && (pending || tool !== "cursor" || selectedId != null)) {
        setPending(null);
        setTool("cursor");
        setSelectedId(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId != null && !pending) {
        e.preventDefault();
        t.removeDrawing(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, tool, selectedId, t]);
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
  const indKey = inds.map((s) => `${s.id}:${s.kind}:${JSON.stringify(s.params)}:${JSON.stringify(s.style ?? null)}`).join("|");
  useEffect(() => {
    if (!round || !inds.length) return;
    let dead = false;
    const slice = chartSlice(round, peekEnd);
    const base = blindBaseOf(round.bars, round.ctx, round.done);
    computeIndicators(slice.bars.slice(0, slice.end), inds, base, greenUp).then(
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
  const draft: Drawing | null = (() => {
    if (!pending || !hover || tool === "cursor" || tool === "hline") return null;
    if (tool === "channel") {
      // A→B: zero-width channel (c on B) so renderer draws dashed preview baseline.
      if (!pending.b) return { id: 0, kind: "channel", a: pending.a, b: hover, c: hover, style: { ...DEFAULT_CHANNEL_STYLE, fill: false } };
      return { id: 0, kind: "channel", a: pending.a, b: pending.b, c: hover, style: DEFAULT_CHANNEL_STYLE };
    }
    return { id: 0, kind: tool, a: pending.a, b: hover };
  })();
  const model = useMemo(
    () => (round ? buildChartModel(round, peekEnd, greenUp) : null),
    // round 就地改。sig 才是「数据变了」的信号，不能拿掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  const ohlc: Ohlc = (() => {
    if (!model) return null;
    const live = model.candles.filter((c) => !c.faded);
    const last = live.at(-1);
    if (!last) return null;
    const hovered = hoverBarTime != null ? model.candles.find((c) => c.time === hoverBarTime) : undefined;
    const bar = hovered ?? last;
    const vols = model.volume.filter((v) => !v.faded).map((v) => v.value);
    const avg = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
    const volPt = model.volume.find((v) => v.time === bar.time);
    const hasVolInd = inds.some((i) => i.kind === "VOL" && !styleOf(i).hidden);
    return {
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      // Avoid twin Vol when VOL sub-pane readout already shows it.
      vol: hasVolInd ? null : avg > 0 && volPt != null ? volPt.value / avg : null,
    };
  })();
  const indReadout: IndReadout[] = (() => {
    const rows: IndReadout[] = [];
    for (const inst of inds) {
      const st = styleOf(inst);
      if (st.hidden) continue;
      const def = defOf(inst.kind);
      if (!def) continue;
      const parts: IndReadout["parts"] = [];
      for (const plot of plots) {
        if (plot.inst !== inst.id || plot.visible === false || plot.id.endsWith(":zero")) continue;
        const slot = plot.id.slice(String(inst.id).length + 1);
        const value = plotValueAt(plot, hoverBarTime);
        if (value == null || !Number.isFinite(value)) continue;
        const d = Math.abs(value) >= 10 ? 2 : 4;
        parts.push({
          key: slot,
          label: slotLabel(inst.kind, slot),
          text: inst.kind === "VOL" && model?.blind ? value.toFixed(2) + "×" : value.toFixed(d),
          color: plot.color,
        });
      }
      if (!parts.length) continue;
      rows.push({ id: inst.id, title: indTitle(inst), color: indColor(inst), parts });
    }
    return rows;
  })();
  const note = !round
    ? "标的与时间已屏蔽"
    : round.done
      ? "已揭盲 · 标的仍隐藏"
      : "标的/时间/价格已屏蔽 · 纵轴=开局收盘 100";
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
    commitInds([...inds, { id, kind: def.kind, params: defaultParams(def), style: defaultStyle({ id, kind: def.kind }) }]);
  };
  const paneModes: Record<string, "collapsed" | "max"> = {};
  for (const inst of inds) {
    const pane = instPane(inst);
    if (pane !== "price" && styleOf(inst).collapsed) paneModes[pane] = "collapsed";
  }
  if (maxPane && !paneModes[maxPane] && inds.some((inst) => instPane(inst) === maxPane)) {
    // While one sub-pane is maximized, every other sub-pane collapses (transient, not persisted).
    for (const inst of inds) {
      const pane = instPane(inst);
      if (pane !== "price") paneModes[pane] = "collapsed";
    }
    paneModes[maxPane] = "max";
  }
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
          ohlc={ohlc}
          indReadout={indReadout}
          blind={!!round && !round.done}
          onView={t.setView}
          onAdd={addInd}
          onRemove={(id) => commitInds(inds.filter((inst) => inst.id !== id))}
        />
        <div id="chartbody" className="flex">
        <ChartTools
          tool={tool}
          pending={!!pending}
          pendingHint={(() => {
            if (tool === "channel") return "点两下定基线，再点一下定宽度";
            if (tool === "cursor" && selectedId != null) {
              const sel = (round?.drawings ?? []).find((d) => d.id === selectedId);
              if (sel?.kind === "channel") {
                return "选中态 · 拖动手柄 A/B 改基线，拖 C 改宽度 · Delete 删除 · 双击打开样式";
              }
            }
            return undefined;
          })()}
          disabled={!round}
          onTool={(next) => {
            setTool(next);
            setPending(null);
            setSelectedId(null);
          }}
          onUndo={() => {
            t.undoDrawing();
            setSelectedId(null);
          }}
          onClear={() => {
            t.clearDrawings();
            setSelectedId(null);
          }}
        />
        <div className="relative min-w-0 flex-1">
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
          selectedId={selectedId}
          tool={tool}
          plots={plots}
          paneModes={paneModes}
          onPanes={onPanes}
          onPick={(anchor) => {
            if (!round || tool === "cursor") return;
            const pend = pendingRef.current;
            if (tool === "hline") {
              t.addDrawing({ id: 0, kind: "hline", price: anchor.price });
              return;
            }
            if (tool === "channel") {
              if (!pend) setPending({ a: anchor });
              else if (!pend.b) setPending({ a: pend.a, b: anchor });
              else {
                t.addDrawing({ id: 0, kind: "channel", a: pend.a, b: pend.b, c: anchor, style: DEFAULT_CHANNEL_STYLE });
                setPending(null);
                setTool("cursor");
              }
              return;
            }
            if (!pend) setPending({ a: anchor });
            else {
              t.addDrawing({ id: 0, kind: tool, a: pend.a, b: anchor });
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
          onHoverBar={(time) => setHoverBarTime((prev) => (prev === time ? prev : time))}
          onSelect={(id) => setSelectedId(id)}
          onUpdateDrawing={(d) => t.updateDrawing(d)}
          onOpenStyle={(id) => {
            setSelectedId(id);
            setStyleId(id);
          }}
          bindFit={t.bindFit}
        />
        <PaneLegend
          boxes={boxes}
          inds={inds}
          plots={plots}
          hoverTime={hoverBarTime}
          onChange={(id, key, value) => commitInds(inds.map((inst) => (inst.id === id ? { ...inst, params: { ...inst.params, [key]: value } } : inst)))}
          onRemove={(id) => commitInds(inds.filter((inst) => inst.id !== id))}
          maxPane={maxPane}
          onMax={setMaxPane}
          onStyle={(id, patch) => commitInds(inds.map((inst) => (inst.id === id ? { ...inst, style: { ...styleOf(inst), ...patch } } : inst)))}
          onSettings={setSetting}
        />
        <IndSettingsDialog
          inst={inds.find((inst) => inst.id === setting) ?? null}
          onApply={(next) => commitInds(inds.map((inst) => (inst.id === next.id ? next : inst)))}
          onClose={() => setSetting(null)}
        />
        <DrawStyleDialog
          drawing={(round?.drawings ?? []).find((d) => d.id === styleId && d.kind === "channel") ?? null}
          onApply={(style: DrawStyle) => {
            const cur = (round?.drawings ?? []).find((d) => d.id === styleId);
            if (!cur || cur.kind !== "channel") return;
            t.updateDrawing({ ...cur, style });
          }}
          onClose={() => setStyleId(null)}
        />
        {t.phase === "empty" && (
          <div id="empty">
            <p>每一局随机抽一个币安合约和一段历史行情，屏蔽币种、日期和价格。K 线一根一根播放，你像在币安上一样开仓、加仓、平仓。</p>
            <Button variant="primary" size="default" onClick={t.start}>
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
      </div>
      <Transport />
    </div>
  );
}
