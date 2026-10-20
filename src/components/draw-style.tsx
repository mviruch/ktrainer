import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_CHANNEL_STYLE, type DrawStyle, type Drawing } from "@/lib/types";

const SWATCHES = ["#2962FF", "#2F6F9F", "#B7800F", "#7A5EA7", "#C46B4A", "#1E7A62", "#3E6B8A", "#37A74C", "#CF4F5F", "#D1D4DC", "#9598A1", "#F7A600"];

function Swatch({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="size-6 shrink-0 cursor-pointer rounded-[4px] border border-line-strong p-0.5">
          <span className="block size-full rounded-[2px]" style={{ background: value }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={`size-5 cursor-pointer rounded-[4px] ${c.toLowerCase() === value.toLowerCase() ? "ring-2 ring-white" : ""}`}
              style={{ background: c }}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function dashIcon(d: DrawStyle["lineStyle"]) {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden>
      <line x1="1" y1="4" x2="15" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray={d === "solid" ? "" : d === "dashed" ? "4 2" : "1 2"} />
    </svg>
  );
}

function resolve(d: Drawing | null): DrawStyle {
  if (d?.kind === "channel" && d.style) return { ...DEFAULT_CHANNEL_STYLE, ...d.style };
  return { ...DEFAULT_CHANNEL_STYLE };
}

export function DrawStyleDialog({
  drawing,
  onApply,
  onClose,
}: {
  drawing: Drawing | null;
  onApply: (style: DrawStyle) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!drawing} onOpenChange={(o) => !o && onClose()}>
      {drawing && <Body key={drawing.id} drawing={drawing} onApply={onApply} onClose={onClose} />}
    </Dialog>
  );
}

function Body({ drawing, onApply, onClose }: { drawing: Drawing; onApply: (style: DrawStyle) => void; onClose: () => void }) {
  const [style, setStyle] = useState<DrawStyle>(() => resolve(drawing));
  const fillColor = style.fillColor ?? style.color;
  const sameFill = !style.fillColor || style.fillColor.toLowerCase() === style.color.toLowerCase();
  return (
    <DialogContent className="w-[min(420px,calc(100%-32px))]">
      <DialogHeader className="mb-0 flex min-h-13 flex-row items-center gap-2 py-0">
        <DialogTitle className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: style.color }} />
          平行通道
        </DialogTitle>
        <DialogDescription className="sr-only">画线样式</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-2">
        <label className="grid grid-cols-[88px_1fr] items-center gap-3 text-[12px] text-fg-2">
          <span>线色</span>
          <div className="flex items-center gap-2">
            <Swatch
              value={style.color}
              label="线色"
              onChange={(color) =>
                setStyle((s) => ({
                  ...s,
                  color,
                  fillColor: !s.fillColor || s.fillColor.toLowerCase() === s.color.toLowerCase() ? undefined : s.fillColor,
                }))
              }
            />
            <span className="num text-[11px] text-fg-3">{style.color.toUpperCase()}</span>
          </div>
        </label>
        <label className="grid grid-cols-[88px_1fr] items-center gap-3 text-[12px] text-fg-2">
          <span>线宽</span>
          <ToggleGroup
            type="single"
            value={String(style.width)}
            onValueChange={(v) => v && setStyle((s) => ({ ...s, width: Number(v) as 1 | 2 | 3 }))}
          >
            {([1, 2, 3] as const).map((w) => (
              <ToggleGroupItem key={w} value={String(w)} className="num min-w-9">
                {w}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </label>
        <label className="grid grid-cols-[88px_1fr] items-center gap-3 text-[12px] text-fg-2">
          <span>线型</span>
          <ToggleGroup
            type="single"
            value={style.lineStyle}
            onValueChange={(v) => v && setStyle((s) => ({ ...s, lineStyle: v as DrawStyle["lineStyle"] }))}
          >
            {(["solid", "dashed", "dotted"] as const).map((d) => (
              <ToggleGroupItem key={d} value={d} aria-label={d} className="min-w-9 px-2">
                {dashIcon(d)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </label>
        <div className="my-1 h-px bg-line" />
        <label className="grid grid-cols-[88px_1fr] items-center gap-3 text-[12px] text-fg-2">
          <span>填充</span>
          <div className="flex items-center gap-2">
            <Switch checked={style.fill} onCheckedChange={(fill) => setStyle((s) => ({ ...s, fill }))} aria-label="填充" />
            <span className="text-[11px] text-fg-3">{style.fill ? "开启" : "关闭"}</span>
          </div>
        </label>
        <label className={`grid grid-cols-[88px_1fr] items-center gap-3 text-[12px] text-fg-2 ${style.fill ? "" : "opacity-40"}`}>
          <span>透明度</span>
          <div className="flex items-center gap-3">
            <Slider
              disabled={!style.fill}
              min={5}
              max={40}
              step={1}
              value={[Math.round(style.fillOpacity * 100)]}
              onValueChange={([v]) => setStyle((s) => ({ ...s, fillOpacity: v / 100 }))}
              className="flex-1"
            />
            <span className="num w-8 text-right text-[11px] text-fg-3">{Math.round(style.fillOpacity * 100)}%</span>
          </div>
        </label>
        <label className={`grid grid-cols-[88px_1fr] items-center gap-3 text-[12px] text-fg-2 ${style.fill ? "" : "opacity-40"}`}>
          <span>填充色</span>
          <div className="flex items-center gap-2">
            <Swatch
              value={fillColor}
              label="填充色"
              onChange={(fillColor) =>
                setStyle((s) => ({
                  ...s,
                  fillColor: fillColor.toLowerCase() === s.color.toLowerCase() ? undefined : fillColor,
                }))
              }
            />
            <span className="text-[11px] text-fg-3">{sameFill ? "默认同线色" : fillColor.toUpperCase()}</span>
          </div>
        </label>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => setStyle({ ...DEFAULT_CHANNEL_STYLE })}>
          恢复默认
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="primary" onClick={() => { onApply(style); onClose(); }}>
            确定
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
