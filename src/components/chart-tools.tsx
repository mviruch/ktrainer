import { useState, type ReactNode } from "react";
import { AlignJustify, Minus, MousePointer2, MoveUpRight, Trash2, TrendingUp, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtNum } from "@/lib/format";
import { IndWindow } from "@/components/ind-window";
import type { IndInst, IndKind } from "@/lib/indicators";
import type { DrawKind, Interval } from "@/lib/types";

const TV_IV: Record<Interval, string> = { "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

export type Tool = "cursor" | DrawKind;

const TOOLS: { id: Tool; title: string; hint: string }[] = [
  { id: "cursor", title: "光标", hint: "拖拽平移，滚轮缩放" },
  { id: "trend", title: "趋势线", hint: "点两下，两点之间的线段" },
  { id: "ray", title: "射线", hint: "点两下，从起点穿过终点一直延伸" },
  { id: "hline", title: "水平线", hint: "点一下放一条水平线" },
  { id: "fib", title: "斐波那契", hint: "点两下，从起点价到终点价" },
  { id: "channel", title: "通道", hint: "点两下定基线，再点一下定宽度" },
];

export function ChartTools({
  tool,
  pending,
  pendingHint,
  disabled,
  onTool,
  onUndo,
  onClear,
}: {
  tool: Tool;
  pending: boolean;
  /** Overrides the default pending / tool hint (e.g. channel 3-point / selected). */
  pendingHint?: string;
  disabled: boolean;
  onTool: (tool: Tool) => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  const hint =
    pendingHint ??
    (pending ? (tool === "channel" ? "点两下定基线，再点一下定宽度" : "再点一下确定终点") : (TOOLS.find((t) => t.id === tool)?.hint ?? ""));
  const railBtn = (key: string, title: string, on: boolean, onClick: () => void, icon: ReactNode) => (
    <Tooltip key={key}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={title}
          aria-pressed={on}
          disabled={disabled}
          className={on ? "bg-brand/15 text-brand hover:bg-brand/20 hover:text-brand" : ""}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
  return (
    <div id="drawtools" className="relative z-[6] flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-1.5">
      {TOOLS.map((item) => railBtn(item.id, item.title, tool === item.id, () => onTool(item.id), toolIcon(item.id)))}
      <Separator className="my-1 !w-6" />
      {railBtn("undo", "撤销上一笔", false, onUndo, <Undo2 />)}
      {railBtn("clear", "清空画线", false, onClear, <Trash2 />)}
      {hint && (tool !== "cursor" || pendingHint) ? (
        <span className="pointer-events-none absolute top-1.5 left-12 rounded-[3px] border border-line-strong bg-elevated px-2 py-1 text-[11px] whitespace-nowrap text-fg-2 shadow-pop">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export type Ohlc = { o: number; h: number; l: number; c: number; vol: number | null } | null;

/** Hover / latest values for one indicator instance shown in the chart header. */
export type IndReadout = {
  id: number;
  title: string;
  color: string;
  parts: { key: string; label: string; text: string; color: string }[];
};

export function ChartBar({
  intervals,
  active,
  inds,
  indError,
  ohlc,
  indReadout,
  blind,
  onView,
  onAdd,
  onRemove,
}: {
  intervals: Interval[];
  active: Interval | "";
  inds: IndInst[];
  indError: string;
  ohlc: Ohlc;
  indReadout: IndReadout[];
  blind: boolean;
  onView: (iv: Interval) => void;
  onAdd: (kind: IndKind) => void;
  onRemove: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const f = (v: number) => (blind ? v.toFixed(2) : fmtNum(v, false));
  const up = ohlc ? ohlc.c >= ohlc.o : true;
  return (
    <div id="chartbar" className="relative z-[5] flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel pr-3 pl-[52px]">
      <ToggleGroup
        type="single"
        value={active}
        onValueChange={(v) => v && onView(v as Interval)}
        aria-label="周期"
      >
        {intervals.map((iv) => (
          <ToggleGroupItem key={iv} value={iv} className="num text-[11px]">
            {TV_IV[iv]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Separator orientation="vertical" className="!h-[18px] shrink-0 !self-center" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" className={open || inds.length ? "text-chalk" : ""}>
            <TrendingUp />
            指标
            {inds.length > 0 && <Badge variant="count">{inds.length}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[560px] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <IndWindow inds={inds} error={indError} onAdd={onAdd} onRemove={onRemove} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {(ohlc || indReadout.length > 0) && (
        <div className="num ml-auto flex min-w-0 shrink items-center gap-2.5 overflow-x-auto text-[11px] text-fg-3">
          {ohlc && (
            <>
              <span>O <i className="text-fg-2 not-italic">{f(ohlc.o)}</i></span>
              <span>H <i className="text-fg-2 not-italic">{f(ohlc.h)}</i></span>
              <span>L <i className="text-fg-2 not-italic">{f(ohlc.l)}</i></span>
              <span>C <i className={`not-italic ${up ? "text-up" : "text-down"}`}>{f(ohlc.c)}</i></span>
              {ohlc.vol != null && <span>Vol <i className="text-fg-2 not-italic">{ohlc.vol.toFixed(2)}×</i></span>}
            </>
          )}
          {indReadout.map((row) => (
            <span key={row.id} className="flex shrink-0 items-center gap-1.5 border-l border-line pl-2.5">
              <b className="font-medium not-italic" style={{ color: row.color }}>{row.title}</b>
              {row.parts.map((part) => (
                <span key={part.key}>
                  {part.label} <i className="not-italic" style={{ color: part.color }}>{part.text}</i>
                </span>
              ))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function toolIcon(id: Tool) {
  if (id === "cursor") return <MousePointer2 />;
  if (id === "trend") return <TrendingUp />;
  if (id === "ray") return <MoveUpRight />;
  if (id === "hline") return <Minus />;
  if (id === "channel") return <ChannelIcon />;
  return <AlignJustify />;
}

function ChannelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M1.5 10.5 L8.5 3.5 L9.6 4.6 L2.6 11.6 Z" opacity="0.35" />
      <path d="M3.5 12.5 L10.5 5.5 L11.6 6.6 L4.6 13.6 Z" opacity="0.35" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M1.8 10.2 L9.2 2.8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M4.2 13.2 L11.6 5.8" />
    </svg>
  );
}
