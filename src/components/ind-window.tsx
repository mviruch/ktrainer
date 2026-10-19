import { useEffect, useState } from "react";
import {
  IND_CATALOG,
  IND_GROUPS,
  defOf,
  indColor,
  indTitle,
  instPane,
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
}: {
  inds: IndInst[];
  error: string;
  onAdd: (kind: IndKind) => void;
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
    <div id="indwin">
      <input
        type="search"
        placeholder="搜索指标"
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="body">
        <nav>
          {IND_GROUPS.map((item) => (
            <button key={item.id} type="button" className={group === item.id ? "on" : ""} onClick={() => setGroup(item.id)}>
              {item.name}
            </button>
          ))}
        </nav>
        <div id="indlist">
          {chunks.length ? (
            chunks.map((chunk) => (
              <section key={chunk.name}>
                <div className="indgroup">{chunk.name}</div>
                {chunk.items.map((def) => {
                  const n = inds.filter((inst) => inst.kind === def.kind).length;
                  return (
                    <button key={def.kind} type="button" className="indrow" onClick={() => onAdd(def.kind)}>
                      <b>{def.name}</b>
                      <span>{def.en}</span>
                      <em>{def.where === "price" ? "主图" : "副图"}</em>
                      {n ? <i>{n}</i> : null}
                    </button>
                  );
                })}
              </section>
            ))
          ) : (
            <p>没有匹配的指标</p>
          )}
        </div>
      </div>
      <p>{error || "点一下就加到图上。主图叠在 K 线上，副图单独一张。只算已经走出的 K 线。"}</p>
    </div>
  );
}

export function PaneLegend({
  boxes,
  inds,
  plots,
  onChange,
  onRemove,
}: {
  boxes: PaneBox[];
  inds: IndInst[];
  plots: Plot[];
  onChange: (id: number, key: string, value: number) => void;
  onRemove: (id: number) => void;
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
  return (
    <>
      {boxes.map((box) => {
        const rows = inds.filter((inst) => instPane(inst) === box.pane);
        if (!rows.length) return null;
        return (
          <div key={box.pane} className="paneleg" style={{ top: box.top + 6 }}>
            {rows.map((inst) => {
              const def = defOf(inst.kind);
              if (!def) return null;
              const open = edit === inst.id;
              return (
                <div key={inst.id} className="legrow" data-leg={inst.id} style={{ color: indColor(inst) }}>
                  <b>{indTitle(inst)}</b>
                  {plots
                    .filter((plot) => plot.inst === inst.id)
                    .map((plot) => {
                      const value = plot.points.at(-1)?.value;
                      if (value == null || !Number.isFinite(value)) return null;
                      return (
                        <em key={plot.id} style={{ color: plot.color }}>
                          {fmtVal(value)}
                        </em>
                      );
                    })}
                  {def.fields.length ? (
                    <button type="button" className="icon" title="参数" onClick={() => setEdit(open ? null : inst.id)}>
                      <GearIcon />
                    </button>
                  ) : null}
                  <button type="button" className="icon" title="去掉" onClick={() => onRemove(inst.id)}>
                    ×
                  </button>
                  {open ? (
                    <div className="legset">
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

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor">
      <circle cx="8" cy="8" r="2.1" strokeWidth="1.3" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
