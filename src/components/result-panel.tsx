import { TradePanel } from "@/components/trade-panel";
import { intervalLabel } from "@/lib/frames";
import { bjDate, fmtPrice, pctFmt, sgnU, uFmt } from "@/lib/format";
import { useTrainer } from "@/state/trainer";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function SideContent() {
  const t = useTrainer();
  return (
    <>
      {t.phase === "trade" && t.round && <TradePanel key={t.round.startedAt} />}
      {t.phase === "result" && <ResultPanel />}
      {t.phase === "loading" && (
        <div className="side-pad">
          <div className="phase">抽取中</div>
          <p className="sheet-copy">{t.loadMsg}</p>
        </div>
      )}
      {t.phase === "error" && (
        <div className="side-pad">
          <div className="phase">拿不到行情</div>
          <p className="sheet-copy">没有拉到真实 K 线。换个网络，或把交易对收成 BTC 再试。</p>
        </div>
      )}
      {t.phase === "empty" && (
        <div className="side-pad">
          <div className="phase">准备</div>
          <p className="sheet-copy">点「开始第一局」抽一段行情。币种、日期和价格轴都会先藏起来。</p>
        </div>
      )}
    </>
  );
}

export function Side() {
  return (
    <aside id="side">
      <SideContent />
    </aside>
  );
}

export function ResultPanel() {
  const t = useTrainer();
  const r = t.result?.rec;
  if (!r) return null;
  const rv = t.reveal?.status;
  const tone = r.pnl > 0 ? "text-up" : r.pnl < 0 ? "text-down" : "text-fg-2";
  const nextLabel = `下一局（本场第 ${(t.acc.runN || 0) + 1} 局）`;
  const kpi = (label: string, value: ReactNode, cls = "") => (
    <div className="flex min-w-0 flex-col gap-1 rounded-[4px] bg-elevated px-2.5 py-2">
      <span className="text-[11px] text-fg-3">{label}</span>
      <b className={`num truncate text-[13px] font-medium ${cls}`}>{value}</b>
    </div>
  );
  return (
    <div className="result-panel flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 text-[12px]">
          <span className={`size-1.5 rounded-full ${rv === "fail" ? "bg-down" : rv === "ok" ? "bg-brand" : "animate-pulse bg-fg-3"}`} />
          {rv === "ok" ? "本局结束 · 已揭盲" : rv === "fail" ? "本局结束 · 揭盲没成功" : "本局结束 · 揭盲中…"}
        </div>
        <div>
          <div className={`num text-[36px] leading-[44px] font-semibold ${tone}`}>{r.fills ? sgnU(r.pnl) : "0.00"}</div>
          <div className="text-[11px] text-fg-3">
            {r.fills ? `本局盈亏 USDT · ${pctFmt(r.pnl / r.startW)} · 已扣手续费` : "这一局没有交易"}
          </div>
        </div>
        <div id="reveal-box" data-reveal={rv ?? "none"} className="rounded-[4px] border border-line-strong bg-brand/5 px-3 py-2.5 text-[12px]">
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <span className="whitespace-nowrap text-fg-2">{rv === "ok" || rv === "fail" ? "标的已隐藏" : "正在揭盲…"}</span>
            <span>周期 {intervalLabel(r.interval)}</span>
          </div>
          {rv === "ok" && (
            <div className="num mt-1 text-[11px] leading-[18px] text-fg-2">
              {bjDate(r.t0)} → {bjDate(r.t1)}
              <span className="reveal-tz">（北京时间）</span>
            </div>
          )}
          {rv !== "ok" && rv !== "fail" && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-3">
              <Loader2 className="size-3 animate-spin" />
              结算已完成，正在核对真实标的和时间
            </div>
          )}
          {rv === "fail" && (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] leading-[18px] text-down">
              <span className="min-w-0 flex-1">揭盲失败：{t.reveal?.error}</span>
              <Button size="xs" className="shrink-0" onClick={t.retryReveal}>
                重试
              </Button>
            </div>
          )}
        </div>
        {t.result?.bust && (
          <div className="rounded-[4px] border border-liq/40 bg-liq/10 px-3 py-2.5 text-[12px] leading-[18px] text-liq">
            ⚠ 账户爆仓了。余额已经重新给到 10,000 U，爆仓次数记在统计里。
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {kpi("结束方式", `${r.reason}${r.peeked ? " · 看过答案" : ""}`)}
          {kpi("走了多少根", r.bars)}
          {kpi("成交笔数", r.fills)}
          {kpi("手续费", r.fees ? "-" + uFmt(r.fees) : uFmt(0))}
          {kpi("本局最大回撤", (r.maxDD ? "-" : "") + (r.maxDD * 100).toFixed(2) + "%", r.maxDD ? "text-down" : "")}
          {r.liqs > 0 ? kpi("被强平", `${r.liqs} 次`, "text-down") : kpi("余额", uFmt(r.endW))}
        </div>
      </div>
      <div className="px-4 pb-1.5 text-[12px] font-medium">成交记录（#是开局后第几根）</div>
      <div id="rs-fills" className="min-h-0 flex-1 overflow-y-auto">
        {r.list.length === 0 ? (
          <div className="tr-empty px-4">没有成交</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">#</TableHead>
                <TableHead>方向</TableHead>
                <TableHead className="text-right">价格</TableHead>
                <TableHead className="text-right">数量 U</TableHead>
                <TableHead className="text-right">盈亏</TableHead>
                <TableHead className="pr-4 text-right">手续费</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.list.map((f, i) => (
                <TableRow key={i}>
                  <TableCell className="num pl-4 text-fg-3">#{f.i}</TableCell>
                  <TableCell className={`rs-t ${f.side > 0 ? "l" : "s"}`}>{f.tag}</TableCell>
                  <TableCell className="num text-right">{fmtPrice(f.price, null)}</TableCell>
                  <TableCell className="num text-right">{uFmt(f.n, 0)}</TableCell>
                  <TableCell className={`num text-right ${f.pnl > 0 ? "text-up" : f.pnl < 0 ? "text-down" : "text-fg-3"}`}>
                    {f.pnl ? sgnU(f.pnl) : "—"}
                  </TableCell>
                  <TableCell className="num pr-4 text-right text-[11px] text-fg-2">{f.fee ? uFmt(f.fee) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line p-4">
        <Button variant="primary" size="lg" className="w-full" onClick={t.next}>
          {nextLabel}
        </Button>
        <Button size="default" className="h-9 w-full" disabled={t.peeking} onClick={t.requestPeek}>
          揭示后面 300 根
        </Button>
      </div>
    </div>
  );
}
