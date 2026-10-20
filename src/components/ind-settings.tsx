import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  defaultParams,
  defaultStyle,
  defOf,
  hasHist,
  IND_COLORS,
  HIST_DOWN,
  HIST_UP,
  HIST_NEUTRAL,
  indColor,
  indTitle,
  lineSlots,
  styleOf,
  type IndInst,
  type IndStyle,
  type LineCfg,
  type LineDash,
} from "@/lib/indicators";

const HIST_SWATCHES = [HIST_UP, HIST_DOWN, "#37A74C", "#CF4F5F", "#8A939D", ...IND_COLORS];

function Swatch({ value, colors, onChange, label }: { value: string; colors: string[]; onChange: (c: string) => void; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="size-6 shrink-0 cursor-pointer rounded-[4px] border border-line-strong p-0.5"
        >
          <span className="block size-full rounded-[2px]" style={{ background: value }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1.5">
          {colors.map((c) => (
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

function dashIcon(d: LineDash) {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden>
      <line x1="1" y1="4" x2="15" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray={d === "solid" ? "" : d === "dashed" ? "4 2" : "1 2"} />
    </svg>
  );
}

export function IndSettingsDialog({ inst, onApply, onClose }: { inst: IndInst | null; onApply: (next: IndInst) => void; onClose: () => void }) {
  return (
    <Dialog open={!!inst} onOpenChange={(o) => !o && onClose()}>
      {inst && <Body key={inst.id} inst={inst} onApply={onApply} onClose={onClose} />}
    </Dialog>
  );
}

function Body({ inst, onApply, onClose }: { inst: IndInst; onApply: (next: IndInst) => void; onClose: () => void }) {
  const def = defOf(inst.kind);
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries((def?.fields ?? []).map((f) => [f.key, String(inst.params[f.key] ?? f.def)])),
  );
  const [style, setStyle] = useState<IndStyle>(() => styleOf(inst));
  const [tab, setTab] = useState("params");
  if (!def) return null;
  const setLine = (key: string, patch: Partial<LineCfg>) => setStyle((s) => ({ ...s, lines: { ...s.lines, [key]: { ...s.lines[key], ...patch } } }));
  const reset = () => {
    if (tab === "params") setParams(Object.fromEntries(Object.entries(defaultParams(def)).map(([k, v]) => [k, String(v)])));
    else setStyle({ ...defaultStyle(inst), hidden: style.hidden, collapsed: style.collapsed });
  };
  const apply = () => {
    const next: Record<string, number> = { ...inst.params };
    for (const f of def.fields) {
      const n = Number(params[f.key]);
      if (!Number.isFinite(n)) continue;
      const stepped = f.step == null ? Math.round(n) : Math.round(n / f.step) * f.step;
      next[f.key] = Math.min(f.max, Math.max(f.min, stepped));
    }
    onApply({ ...inst, params: next, style });
    onClose();
  };
  return (
    <DialogContent className="w-[min(560px,calc(100%-32px))]">
      <DialogHeader className="mb-0 flex min-h-13 flex-row items-center gap-2 py-0">
        <DialogTitle className="num flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: indColor(inst) }} />
          {indTitle(inst)}
        </DialogTitle>
        <span className="text-[12px] text-fg-3">
          {def.name} · {def.where === "price" ? "主图" : "副图"}
        </span>
        <DialogDescription className="sr-only">指标参数与样式</DialogDescription>
      </DialogHeader>
      <Tabs value={tab} onValueChange={setTab} className="!mx-0">
        <TabsList className="mb-0 px-5 pt-1 [&>button]:pb-2">
          <TabsTrigger value="params">参数</TabsTrigger>
          <TabsTrigger value="style">样式</TabsTrigger>
        </TabsList>
        <TabsContent value="params" className="flex min-h-[300px] flex-col gap-3 px-5 pt-4">
          {def.fields.length === 0 && <p className="text-[12px] text-fg-3">这个指标没有可调参数。</p>}
          {def.fields.map((f) => (
            <label key={f.key} className="grid grid-cols-[120px_1fr_88px] items-center gap-3 text-[12px] text-fg-2">
              <span>{f.label}</span>
              <Input
                value={params[f.key] ?? ""}
                inputMode="decimal"
                className="h-8 bg-panel"
                onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && apply()}
              />
              <span className="num text-right text-[11px] text-fg-3">
                {f.min} – {f.max}
              </span>
            </label>
          ))}
          <p className="text-[11px] leading-[18px] text-fg-3">只算已经走出的 K 线；超出范围的数会被夹到允许区间。</p>
        </TabsContent>
        <TabsContent value="style" className="flex min-h-[300px] flex-col gap-2.5 px-5 pt-4">
          <div className="grid grid-cols-[28px_64px_24px_94px_94px] items-center gap-3 text-[11px] text-fg-3">
            <span>显示</span>
            <span>线条</span>
            <span>颜色</span>
            <span>线宽</span>
            <span>线型</span>
          </div>
          {lineSlots(inst.kind).map((slot) => {
            const cfg = style.lines[slot.key];
            return (
              <div key={slot.key} className="grid grid-cols-[28px_64px_24px_94px_94px] items-center justify-start gap-3 text-[12px]">
                <Switch checked={cfg.visible} onCheckedChange={(v) => setLine(slot.key, { visible: v })} aria-label={`${slot.label} 显示`} />
                <span className="text-fg-2">{slot.label}</span>
                <Swatch label={`${slot.label} 颜色`} value={cfg.color} colors={slot.key === "zero" ? [HIST_NEUTRAL, ...IND_COLORS] : IND_COLORS} onChange={(c) => setLine(slot.key, { color: c })} />
                <ToggleGroup
                  type="single"
                  value={String(cfg.width)}
                  onValueChange={(v) => v && setLine(slot.key, { width: Number(v) as 1 | 2 | 3 })}
                  className="rounded-[4px] bg-panel p-0.5"
                  aria-label="线宽"
                >
                  {[1, 2, 3].map((w) => (
                    <ToggleGroupItem key={w} value={String(w)} className="h-[26px] w-7 px-0" aria-label={`线宽 ${w}`}>
                      <span className="block w-3.5 rounded-full bg-current" style={{ height: w }} />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <ToggleGroup
                  type="single"
                  value={cfg.dash}
                  onValueChange={(v) => v && setLine(slot.key, { dash: v as LineDash })}
                  className="rounded-[4px] bg-panel p-0.5"
                  aria-label="线型"
                >
                  {(["solid", "dashed", "dotted"] as LineDash[]).map((d) => (
                    <ToggleGroupItem key={d} value={d} className="h-[26px] w-7 px-0" aria-label={d === "solid" ? "实线" : d === "dashed" ? "虚线" : "点线"}>
                      {dashIcon(d)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            );
          })}
          {hasHist(inst.kind) && (
            <>
              <div className="mt-2 border-t border-line pt-3 text-[11px] text-fg-3">柱状图</div>
              <div className="flex items-center gap-3 text-[12px]">
                <span className="w-[100px] text-fg-2">正 / 负</span>
                <Swatch label="正柱颜色" value={style.histUp} colors={HIST_SWATCHES} onChange={(c) => setStyle((s) => ({ ...s, histUp: c }))} />
                <Swatch label="负柱颜色" value={style.histDown} colors={HIST_SWATCHES} onChange={(c) => setStyle((s) => ({ ...s, histDown: c }))} />
              </div>
              <div className="flex items-center gap-3 text-[12px]">
                <span className="w-[100px] text-fg-2">透明度</span>
                <Slider
                  className="!w-[220px] shrink-0"
                  value={[Math.round(style.histOpacity * 100)]}
                  min={10}
                  max={100}
                  step={5}
                  onValueChange={([v]) => setStyle((s) => ({ ...s, histOpacity: (v ?? 55) / 100 }))}
                />
                <span className="num w-10 text-right text-[11px] text-fg-2">{Math.round(style.histOpacity * 100)}%</span>
              </div>
              <label className="flex items-center gap-3 text-[12px] text-fg-2">
                <Switch checked={style.histFollow} onCheckedChange={(v) => setStyle((s) => ({ ...s, histFollow: v }))} />
                柱状图颜色跟随涨跌配色
              </label>
            </>
          )}
        </TabsContent>
      </Tabs>
      <DialogFooter className="items-center">
        <Button variant="link" size="xs" className="mr-auto" onClick={reset}>
          恢复默认
        </Button>
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" onClick={apply}>
          确定
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
