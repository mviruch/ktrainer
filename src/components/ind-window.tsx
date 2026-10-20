import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Maximize2, Minimize2, Plus, Settings, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  IND_CATALOG,
  IND_GROUPS,
  defOf,
  indColor,
  indTitle,
  instPane,
  styleOf,
  type IndStyle,
  type IndGroup,
  type IndInst,
  type IndKind,
  type PaneBox,
  type Plot,
} from "@/lib/indicators";

export function IndWindow({
  inds,
  error,
  onAdd,
  onRemove,
  onClose,
}: {
  inds: IndInst[];
  error: string;
  onAdd: (kind: IndKind) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<IndGroup | "all">("all");
  const needle = q.trim().toLowerCase();
  const rows = IND_CATALOG.filter((def) => {
    if (group !== "all" && def.group !== group) return false;
    if (!needle) return true;
    return `${def.name} ${def.en} ${def.kind} ${def.alias}`.toLowerCase().includes(needle);
  });
  const chunks: { name: string; items: typeof rows }[] = [];
  for (const def of rows) {
    const name = IND_GROUPS.find((item) => item.id === def.group)?.name ?? "";
    const last = chunks[chunks.length - 1];
    if (!last || last.name !== name) chunks.push({ name, items: [def] });
    else last.items.push(def);
  }
  return (
    <div className="flex max-h-[min(669px,calc(100vh-140px))] flex-col">
      <div className="flex h-13 shrink-0 items-center justify-between border-b border-line px-5">
        <span className="text-[15px] font-medium">指标</span>
        <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line px-4 py-3">
        <Input type="search" placeholder="搜索指标" value={q} autoFocus className="h-8 text-left font-sans" onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-fg-3">图上已有 {inds.length} 个</span>
          {inds.length === 0 && <span className="text-[11px] text-fg-3">· 还没加指标</span>}
          {inds.map((inst) => (
            <span
              key={inst.id}
              className="num inline-flex h-6 items-center gap-1 rounded-[12px] border border-line-strong pr-1 pl-2.5 text-[11px]"
              style={{ color: indColor(inst) }}
            >
              {indTitle(inst)}
              <button type="button" aria-label="移除" className="grid size-4 cursor-pointer place-items-center rounded-full text-fg-3 hover:bg-hov hover:text-chalk" onClick={() => onRemove(inst.id)}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[96px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-0.5 border-r border-line p-2">
          {IND_GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`cursor-pointer rounded-[4px] px-2 py-1.5 text-left text-[12px] ${group === item.id ? "bg-brand/15 text-brand" : "text-fg-2 hover:bg-hov hover:text-chalk"}`}
              onClick={() => setGroup(item.id)}
            >
              {item.name}
            </button>
          ))}
        </nav>
        <div className="min-h-0 overflow-auto px-2 pt-1 pb-2">
          {chunks.length ? (
            chunks.map((chunk) => (
              <section key={chunk.name}>
                <div className="px-2 pt-2 pb-1 text-[11px] text-fg-3">{chunk.name}</div>
                {chunk.items.map((def) => {
                  const n = inds.filter((inst) => inst.kind === def.kind).length;
                  return (
                    <button
                      key={def.kind}
                      type="button"
                      className="group flex h-8 w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 text-left hover:bg-hov"
                      onClick={() => onAdd(def.kind)}
                    >
                      <b className="text-[12px] font-medium text-chalk">{def.name}</b>
                      <span className="num text-[11px] text-fg-3">{def.en}</span>
                      {n ? <Badge variant="count">{n}</Badge> : null}
                      <Badge variant="outline" className="ml-auto font-normal">
                        {def.where === "price" ? "主图" : "副图"}
                      </Badge>
                      <span className="hidden items-center gap-0.5 text-[11px] text-brand group-hover:inline-flex">
                        <Plus className="size-3" />
                        添加
                      </span>
                    </button>
                  );
                })}
              </section>
            ))
          ) : (
            <p className="m-4 text-[12px] text-fg-3">没有匹配的指标</p>
          )}
        </div>
      </div>
      <p className="m-0 shrink-0 border-t border-line px-5 py-2.5 text-[11px] leading-[18px] text-fg-3">
        {error || "点一下就加到图上。主图叠在 K 线上，副图单独一张。只算已经走出的 K 线。"}
      </p>
    </div>
  );
}

export function PaneLegend({
  boxes,
  inds,
  plots,
  maxPane,
  onChange,
  onRemove,
  onStyle,
  onSettings,
  onMax,
}: {
  boxes: PaneBox[];
  inds: IndInst[];
  plots: Plot[];
  maxPane: string | null;
  onChange: (id: number, key: string, value: number) => void;
  onRemove: (id: number) => void;
  onStyle: (id: number, patch: Partial<IndStyle>) => void;
  onSettings: (id: number) => void;
  onMax: (pane: string | null) => void;
}) {
  const [edit, setEdit] = useState<number | null>(null);
  useEffect(() => {
    if (edit == null) return;
    const close = (e: MouseEvent) => {
      const node = e.target as HTMLElement | null;
      if (!node?.closest(`[data-leg="${edit}"]`)) setEdit(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [edit]);
  const icon = (title: string, onClick: () => void, el: ReactNode) => (
    <button type="button" className="icon" title={title} aria-label={title} onClick={onClick}>
      {el}
    </button>
  );
  return (
    <>
      {boxes.map((box) => {
        const rows = inds.filter((inst) => instPane(inst) === box.pane);
        if (!rows.length) return null;
        const sub = box.pane !== "price";
        return (
          <div key={box.pane} className={`paneleg ${sub ? "sub" : ""}`} style={{ top: box.top + (sub ? 2 : 6) }}>
            {rows.map((inst) => {
              const def = defOf(inst.kind);
              if (!def) return null;
              const open = edit === inst.id;
              const st = styleOf(inst);
              const off = st.hidden;
              return (
                <div key={inst.id} className={`legrow ${off ? "off" : ""}`} data-leg={inst.id} style={{ color: indColor(inst) }}>
                  <b>{indTitle(inst)}</b>
                  {!off &&
                    !st.collapsed &&
                    plots
                      .filter((plot) => plot.inst === inst.id && plot.visible !== false && !plot.id.endsWith(":zero"))
                      .map((plot) => {
                        const value = plot.points.at(-1)?.value;
                        if (value == null || !Number.isFinite(value)) return null;
                        return (
                          <em key={plot.id} style={{ color: plot.style === "hist" ? undefined : plot.color }}>
                            {fmtVal(value)}
                          </em>
                        );
                      })}
                  {icon(off ? "显示" : "隐藏", () => onStyle(inst.id, { hidden: !off }), off ? <EyeOff /> : <Eye />)}
                  {sub &&
                    icon(st.collapsed ? "展开" : "收起", () => {
                      if (!st.collapsed && maxPane === box.pane) onMax(null);
                      onStyle(inst.id, { collapsed: !st.collapsed });
                    }, st.collapsed ? <ChevronDown /> : <ChevronUp />)}
                  {sub &&
                    icon(maxPane === box.pane ? "还原" : "最大化", () => {
                      if (st.collapsed) onStyle(inst.id, { collapsed: false });
                      onMax(maxPane === box.pane ? null : box.pane);
                    }, maxPane === box.pane ? <Minimize2 /> : <Maximize2 />)}
                  {icon("设置", () => (def.fields.length ? setEdit(open ? null : inst.id) : onSettings(inst.id)), <Settings />)}
                  {icon("去掉", () => onRemove(inst.id), <X />)}
                  {open ? (
                    <div className="legset">
                      <div className="num flex items-center gap-1.5 text-[12px] font-medium text-chalk">
                        <span className="size-2 rounded-full" style={{ background: indColor(inst) }} />
                        {indTitle(inst)}
                      </div>
                      {def.fields.map((field) => (
                        <label key={field.key}>
                          <span>{field.label}</span>
                          <input
                            key={inst.params[field.key] ?? field.def}
                            defaultValue={inst.params[field.key] ?? field.def}
                            inputMode="decimal"
                            onBlur={(e) => commitField(e.target.value, field, (value) => onChange(inst.id, field.key, value))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                          />
                        </label>
                      ))}
                      <Button
                        variant="link"
                        size="xs"
                        className="mt-1 justify-start border-t border-line pt-2"
                        onClick={() => {
                          setEdit(null);
                          onSettings(inst.id);
                        }}
                      >
                        更多设置…
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function commitField(raw: string, field: { min: number; max: number; step?: number }, onChange: (value: number) => void) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  const stepped = field.step == null ? Math.round(n) : Math.round(n / field.step) * field.step;
  onChange(Math.min(field.max, Math.max(field.min, stepped)));
}

function fmtVal(v: number) {
  const d = Math.abs(v) >= 10 ? 2 : 4;
  return v.toFixed(d);
}

