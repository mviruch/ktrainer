import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { BarChart3, CircleHelp, Settings } from "lucide-react";
import { FIXED } from "@/lib/constants";
import { equityAt, priceNow } from "@/lib/engine";
import { pctFmt, sgnU, uFmt } from "@/lib/format";
import { useTrainer } from "@/state/trainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function Metric({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex shrink-0 flex-col justify-center gap-0.5 ${className}`}>
      <span className="text-[11px] leading-none whitespace-nowrap text-fg-3">{label}</span>
      <b className="num text-[13px] leading-[18px] font-medium whitespace-nowrap">{children}</b>
    </div>
  );
}

export function Readout() {
  const t = useTrainer();
  const nav = useNavigate();
  const done = t.log.filter((r) => r.fills > 0);
  const wins = done.filter((r) => r.pnl > 0).length;
  const live = t.round && !t.round.done ? equityAt(t.round, priceNow(t.round)) : t.acc.wallet;
  const settled = t.phase === "result" ? t.result?.rec : null;
  // Keep the settled round's final P&L on the result page; cleared when the next round starts.
  const rp = t.round && !t.round.done ? live - t.round.startWallet : settled && settled.fills ? settled.pnl : null;
  const rpBase = t.round && !t.round.done ? t.round.startWallet : (settled?.startW ?? 1);
  const tot = t.log.reduce((a, r) => a + r.pnl, 0);
  const fee = t.log.reduce((a, r) => a + (r.fees || 0), 0);
  const tone = (v: number | null) => (v == null || v === 0 ? "" : v > 0 ? "text-up" : "text-down");
  const icon = (label: string, to: string, el: ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={() => nav(to)}>
          {el}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
  return (
    <header id="readout" className="flex h-14 shrink-0 items-center gap-5 overflow-x-auto border-b border-line bg-panel px-4">
      <div className="flex shrink-0 items-center gap-2">
        <span className="size-5 rounded-[4px] bg-brand" aria-hidden />
        <span className="text-[14px] font-bold">ktrainer</span>
        <Badge>盲测 · USDT 永续</Badge>
      </div>
      <Separator orientation="vertical" className="!h-7" />
      <Metric label="初始本金">{uFmt(FIXED.account, 0)}</Metric>
      <div className="flex shrink-0 flex-col justify-center gap-0.5">
        <span className="text-[11px] leading-none text-fg-3">账户权益 USDT</span>
        <b className="num text-[20px] leading-6 font-semibold">{uFmt(live)}</b>
      </div>
      <Metric label="本局盈亏">
        {rp == null ? (
          <span className="text-fg-3">—</span>
        ) : (
          <span className={tone(rp)}>
            {sgnU(rp)} <small className="text-[11px]">{pctFmt(rp / (rpBase || 1))}</small>
          </span>
        )}
      </Metric>
      <Separator orientation="vertical" className="!h-7" />
      <Metric label="本场进度">
        {t.acc.runN || 0} / {FIXED.runSize}
      </Metric>
      <Metric label="累计局数">{t.log.length}</Metric>
      <Metric label="胜率">{done.length ? Math.round((wins / done.length) * 100) + "%" : "—"}</Metric>
      <Metric label="累计盈亏">
        <span className={t.log.length ? tone(tot) : "text-fg-3"}>{t.log.length ? sgnU(tot) : "—"}</span>
      </Metric>
      <Metric label="累计手续费">{fee ? "-" + uFmt(fee) : uFmt(0)}</Metric>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {icon("统计", "/stats", <BarChart3 />)}
        {icon("设置", "/settings", <Settings />)}
        {icon("说明", "/help", <CircleHelp />)}
      </div>
    </header>
  );
}
