import { useEffect, useRef, useState, type ReactNode } from "react";
import { IndWindow } from "@/components/ind-window";
import type { IndInst, IndKind } from "@/lib/indicators";
import type { DrawKind, Interval } from "@/lib/types";

const TV_IV: Record<Interval, string> = { "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

export type Tool = "cursor" | DrawKind;

const TOOLS: { id: Tool; title: string; hint: string }[] = [
  { id: "cursor", title: "光标", hint: "拖拽平移，滚轮缩放" },
  { id: "trend", title: "趋势线", hint: "点两下，两点之间的线段" },
  { id: "ray", title: "射线", hint: "点两下，从起点穿过终点一直延伸" },
  { id: "hline", title: "水平线", hint: "点一下放一条水平线" },
  { id: "fib", title: "斐波那契", hint: "点两下，从起点价到终点价" },
];

export function ChartTools({
  tool,
  pending,
  disabled,
  onTool,
  onUndo,
  onClear,
}: {
  tool: Tool;
  pending: boolean;
  disabled: boolean;
  onTool: (tool: Tool) => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  const hint = pending ? "再点一下确定终点" : (TOOLS.find((t) => t.id === tool)?.hint ?? "");
  return (
    <div id="drawtools">
      {TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.title}
          disabled={disabled}
          className={tool === item.id ? "on" : ""}
          onClick={() => onTool(item.id)}
        >
          {toolIcon(item.id, tool === item.id)}
        </button>
      ))}
      <i />
      <button type="button" title="撤销上一笔" disabled={disabled} onClick={onUndo}>
        <UndoIcon />
      </button>
      <button type="button" title="清空画线" disabled={disabled} onClick={onClear}>
        <ClearIcon />
      </button>
      {hint && tool !== "cursor" ? <span id="drawhint">{hint}</span> : null}
    </div>
  );
}

export function ChartBar({
  intervals,
  active,
  note,
  inds,
  indError,
  onView,
  onAdd,
}: {
  intervals: Interval[];
  active: Interval | "";
  note: string;
  inds: IndInst[];
  indError: string;
  onView: (iv: Interval) => void;
  onAdd: (kind: IndKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div id="chartbar">
      <div id="tfs">
        {intervals.map((iv) => (
          <button key={iv} type="button" className={iv === active ? "on" : ""} onClick={() => onView(iv)}>
            {TV_IV[iv]}
          </button>
        ))}
      </div>
      <span className="vsep" />
      <div id="indwrap" ref={pop}>
        <button type="button" id="indbtn" className={open ? "on" : ""} onClick={() => setOpen((v) => !v)}>
          <FxIcon />
          指标
        </button>
        {open ? <IndWindow inds={inds} error={indError} onAdd={onAdd} /> : null}
      </div>
      <span id="chartnote">{note}</span>
    </div>
  );
}

function toolIcon(id: Tool, on: boolean) {
  if (id === "cursor") return <CursorIcon on={on} />;
  if (id === "trend") return <TrendIcon />;
  if (id === "ray") return <RayIcon />;
  if (id === "hline") return <HLineIcon />;
  return <FibIcon />;
}

function svg(children: ReactNode) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" stroke="currentColor" fill="none">
      {children}
    </svg>
  );
}

function CursorIcon({ on }: { on: boolean }) {
  return svg(<path d="M3 2.5 3 13.2 6.2 10.1 8.3 13.6 9.8 12.9 7.7 9.5 11.4 9.2Z" fill="currentColor" stroke="none" opacity={on ? 1 : 0.85} />);
}

function TrendIcon() {
  return svg(<path d="M2.5 12.5 13.5 3.5" strokeWidth="1.4" strokeLinecap="round" />);
}

function RayIcon() {
  return svg(
    <>
      <path d="M2.5 11.5 9 6" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9 6 13.5 2.2" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1.5 1.6" />
    </>,
  );
}

function HLineIcon() {
  return svg(<path d="M2 8h12" strokeWidth="1.4" strokeLinecap="round" />);
}

function FibIcon() {
  return svg(
    <>
      <path d="M2 4h12M2 8h12M2 12h12" strokeWidth="1.2" />
      <path d="M3 12.5 13 3.5" strokeWidth="1.2" />
    </>,
  );
}

function UndoIcon() {
  return svg(<path d="M6 4.5H3.2V2M3.4 4.6A5 5 0 1 1 3.2 9" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />);
}

function ClearIcon() {
  return svg(<path d="M3.5 4.5h9M6 4.5V3.2h4V4.5M5 6.2 5.6 13h4.8l.6-6.8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />);
}

function FxIcon() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" stroke="currentColor" fill="none">
      <path d="M4.2 14.2 6.2 3.2H10" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.4 8.2H9" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.2 11.2 15.2 15.2M15.2 11.2 11.2 15.2" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
