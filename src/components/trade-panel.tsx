import { useState } from "react";
import { FEE_MAKER, FEE_TAKER, MMR } from "@/lib/constants";
import { availBal, equityAt, liqPrice, maxOpen, posIM, priceNow, uPnl } from "@/lib/engine";
import { blindBaseOf, fmtPrice, parsePrice, pctFmt, sgnU, uFmt, filterDecimal } from "@/lib/format";
import type { OrderTab, Side } from "@/lib/types";
import { useTrainer } from "@/state/trainer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePhoneLayout } from "@/components/phone-order";

export function TradePanel() {
  const t = useTrainer();
  const phone = usePhoneLayout();
  const round = t.round;
  const [amt, setAmt] = useState("");
  const [pct, setPct] = useState(0);
  const [limit, setLimit] = useState("");
  const [tpslOn, setTpslOn] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");

  if (!round || round.done) return null;
  const base = blindBaseOf(round.bars, round.ctx, false);
  const p = priceNow(round);
  const notional = parseFloat(amt.replace(/[^0-9.]/g, "")) || 0;
  const rate = t.tab === "market" ? FEE_TAKER : FEE_MAKER;
  const locked = !!round.pos || round.orders.length > 0;
  const P = round.pos;

  function applyPct(v: number) {
    setPct(v);
    const f = v / 100;
    setAmt(f > 0 ? String(Math.floor(maxOpen(round!, 1, t.acc.lev) * f * 0.999)) : "");
  }

  function send(side: Side) {
    const ok = t.place({
      side,
      tab: t.tab,
      notional,
      limit: t.tab === "limit" ? parsePrice(limit, base) : null,
      tp: tpslOn && tp.trim() ? parsePrice(tp, base) : null,
      sl: tpslOn && sl.trim() ? parsePrice(sl, base) : null,
      lev: t.acc.lev,
    });
    if (ok) {
      setAmt("");
      setPct(0);
    }
  }

  function onTab(next: string) {
    const tab: OrderTab = next === "limit" ? "limit" : "market";
    t.setTab(tab);
    if (tab === "limit" && !limit) setLimit(fmtPrice(p, base));
  }

  const lockTip = "有持仓或挂单时不能改保证金模式和杠杆";
  const topBtn = (label: string, cls: string, kind: "mode" | "lev") => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex-1" tabIndex={locked ? 0 : -1}>
          <Button size="sm" disabled={locked} className={`w-full ${cls}`} onClick={() => t.openDialog({ kind })}>
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      {locked && <TooltipContent>{lockTip}</TooltipContent>}
    </Tooltip>
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 pt-3 pb-4">
        <div className="flex gap-2">
          {topBtn(t.acc.mode === "cross" ? "全仓" : "逐仓", "", "mode")}
          {topBtn(`${t.acc.lev}x`, "num font-semibold text-liq", "lev")}
        </div>
        <Tabs value={t.tab} onValueChange={onTab}>
          <TabsList className="mb-0">
            <TabsTrigger value="market">市价</TabsTrigger>
            <TabsTrigger value="limit">限价</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex justify-between text-[11px] text-fg-3">
          <span>可用</span>
          <b className="num font-normal text-fg-2">{uFmt(availBal(round, p))} USDT</b>
        </div>
        <div className={`tr-field ${t.tab === "market" ? "opacity-70" : ""}`}>
          <span>价格</span>
          {t.tab === "limit" ? (
            <>
              <input value={limit} inputMode="decimal" autoComplete="off" onChange={(e) => setLimit(filterDecimal(e.target.value))} />
              <Button variant="link" size="xs" onClick={() => setLimit(fmtPrice(p, base))}>
                最新
              </Button>
            </>
          ) : (
            <>
              <input value="最新价" readOnly tabIndex={-1} className="!font-sans !text-[12px]" aria-label="市价按最新价成交" />
              <em className="num">{fmtPrice(p, base)}</em>
            </>
          )}
        </div>
        <div className="tr-field">
          <span>数量</span>
          <input
            value={amt}
            inputMode="decimal"
            placeholder="仓位价值"
            autoComplete="off"
            onChange={(e) => {
              setAmt(filterDecimal(e.target.value));
              setPct(0);
            }}
          />
          <em>USDT</em>
        </div>
        <div className="flex flex-col gap-1">
          <div className="relative flex h-4 items-center">
            <Slider value={[pct]} max={100} step={1} onValueChange={([v]) => applyPct(v ?? 0)} />
          </div>
          <div className="flex justify-between">
            {[0, 25, 50, 75, 100].map((n) => (
              <button
                key={n}
                type="button"
                className={`num cursor-pointer text-[10px] hover:text-chalk ${pct === n && n > 0 ? "text-chalk" : "text-fg-3"}`}
                onClick={() => applyPct(n)}
              >
                {n}%
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label className="flex cursor-pointer items-center gap-2 text-[12px]">
            <Checkbox checked={tpslOn} onCheckedChange={(v) => setTpslOn(v === true)} />
            带止盈止损
          </Label>
          <span className="text-[11px] text-fg-3">触发价按最新价</span>
        </div>
        {tpslOn && (
          <div className="grid grid-cols-2 gap-2">
            <div className="tr-field">
              <span>止盈</span>
              <input value={tp} inputMode="decimal" placeholder="触发价" autoComplete="off" onChange={(e) => setTp(filterDecimal(e.target.value))} />
            </div>
            <div className="tr-field">
              <span>止损</span>
              <input value={sl} inputMode="decimal" placeholder="触发价" autoComplete="off" onChange={(e) => setSl(filterDecimal(e.target.value))} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="buy" className="btn-buy h-11 flex-col gap-0 leading-tight" onClick={() => send(1)}>
            <span className="text-[13px]">买入 / 做多</span>
            <span className="num text-[10px] font-normal opacity-80">可开多 {uFmt(maxOpen(round, 1, t.acc.lev), 0)} U</span>
          </Button>
          <Button variant="sell" className="btn-sell h-11 flex-col gap-0 leading-tight" onClick={() => send(-1)}>
            <span className="text-[13px]">卖出 / 做空</span>
            <span className="num text-[10px] font-normal opacity-80">可开空 {uFmt(maxOpen(round, -1, t.acc.lev), 0)} U</span>
          </Button>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[4px] bg-elevated px-3 py-2.5 text-[12px]">
          <div className="text-[11px] text-fg-3">本单预估</div>
          <div className="flex justify-between">
            <span className="text-fg-2">保证金</span>
            <b className="num font-medium">{uFmt(notional / t.acc.lev)} U</b>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-2">手续费 ≈</span>
            <b className="num font-medium">{uFmt(notional * rate)} U</b>
          </div>
        </div>
      </div>

      <section className="border-t border-line px-4 py-3">
        <div className="tr-sec">
          <b>持仓 {P ? <i>1</i> : null}</b>
          {P && (
            <Button size="xs" onClick={() => t.closePart(1)}>
              市价全平
            </Button>
          )}
        </div>
        {!P && <div className="tr-empty">没有持仓</div>}
        {P && <Position onEdit={() => t.openDialog({ kind: "tpsl" })} onClose={(f) => t.closePart(f)} onReverse={t.requestReverse} />}
      </section>

      <section className="border-t border-line px-4 py-3">
        <div className="tr-sec">
          <b>
            当前委托 <i>{round.orders.length || ""}</i>
          </b>
          {round.orders.length > 0 && (
            <Button size="xs" onClick={t.cancelAll}>
              全部撤销
            </Button>
          )}
        </div>
        {round.orders.length === 0 && <div className="tr-empty">没有挂单</div>}
        {round.orders.map((o) => (
          <div className="tr-order" key={o.id}>
            <Badge variant="pending">{o.side > 0 ? "限价买" : "限价卖"}</Badge>
            <b className="num font-normal">{fmtPrice(o.price, base)}</b>
            <span className="num text-fg-2">
              · {uFmt(o.qty * o.price, 0)} U{o.tp || o.sl ? " · 带止盈止损" : ""}
            </span>
            <Button variant="link" size="xs" className="grow" onClick={() => t.cancel(o.id)}>
              撤单
            </Button>
          </div>
        ))}
      </section>

      <section className="border-t border-line px-4 py-3">
        <div className="tr-sec">
          <b>账户</b>
        </div>
        <AccountGrid />
        {/* Wide only: primary end entry. Phone uses transport 「结束」. */}
        {!phone && (
          <Button variant="danger" className="mt-3 h-9 w-full" onClick={t.requestEnd}>
            结束本局
          </Button>
        )}
      </section>
    </div>
  );
}

function Position({ onEdit, onClose, onReverse }: { onEdit: () => void; onClose: (f: number) => void; onReverse: () => void }) {
  const t = useTrainer();
  const round = t.round;
  if (!round?.pos) return null;
  const P = round.pos;
  const base = blindBaseOf(round.bars, round.ctx, false);
  const p = priceNow(round);
  const u = uPnl(round, p);
  const im0 = (P.qty * P.entry) / P.lev;
  const mb = P.mode === "isolated" ? P.margin + u : round.wallet + u;
  const ratio = mb > 0 ? (P.qty * p * MMR) / mb : 1;
  const lq = liqPrice(round);
  const col = u >= 0 ? "var(--up)" : "var(--down)";
  return (
    <div>
      <div className="tr-poshd">
        <Badge variant={P.side > 0 ? "up" : "down"} className={`tr-badge ${P.side > 0 ? "l" : "s"}`}>
          {P.side > 0 ? "多" : "空"} {P.lev}x
        </Badge>
        <span className="text-[11px] text-fg-3">{P.mode === "cross" ? "全仓" : "逐仓"}</span>
        <b className="num" style={{ color: col }}>
          {sgnU(u)} <small>({pctFmt(im0 ? u / im0 : 0)})</small>
        </b>
      </div>
      <div className="tr-grid">
        <div>
          <span>仓位价值</span>
          <b className="num">{uFmt(P.qty * p)}</b>
        </div>
        <div>
          <span>保证金</span>
          <b className="num">{uFmt(P.mode === "isolated" ? P.margin : posIM(round, p))}</b>
        </div>
        <div>
          <span>保证金比率</span>
          <b className="num" style={{ color: ratio > 0.6 ? "var(--down)" : "" }}>
            {(ratio * 100).toFixed(2)}%
          </b>
        </div>
        <div>
          <span>开仓均价</span>
          <b className="num">{fmtPrice(P.entry, base)}</b>
        </div>
        <div>
          <span>最新价</span>
          <b className="num">{fmtPrice(p, base)}</b>
        </div>
        <div>
          <span>强平价</span>
          <b className="num" style={{ color: "var(--liq)" }}>
            {lq ? fmtPrice(lq, base) : "—"}
          </b>
        </div>
      </div>
      <div className="tr-tpsl-row">
        <span>止盈 / 止损</span>
        <b className="num">
          <i style={{ color: "var(--up)" }}>{P.tp ? fmtPrice(P.tp, base) : "—"}</i>
          {" / "}
          <i style={{ color: "var(--down)" }}>{P.sl ? fmtPrice(P.sl, base) : "—"}</i>
        </b>
        <Button variant="link" size="xs" onClick={onEdit}>
          设置
        </Button>
      </div>
      <div className="tr-closebar">
        <Button size="xs" onClick={() => onClose(0.25)}>
          平 25%
        </Button>
        <Button size="xs" onClick={() => onClose(0.5)}>
          平 50%
        </Button>
        <Button size="xs" onClick={onEdit}>
          止盈 / 止损
        </Button>
        <Button size="xs" onClick={onReverse}>
          反手
        </Button>
      </div>
    </div>
  );
}

function AccountGrid() {
  const t = useTrainer();
  const round = t.round;
  if (!round) return null;
  const p = priceNow(round);
  const eq = equityAt(round, p);
  const rp = eq - round.startWallet;
  const u = uPnl(round, p);
  return (
    <div className="tr-grid">
      <div>
        <span>钱包余额</span>
        <b className="num">{uFmt(round.wallet)}</b>
      </div>
      <div>
        <span>未实现盈亏</span>
        <b className="num" style={{ color: u >= 0 ? "var(--up)" : "var(--down)" }}>
          {sgnU(u)}
        </b>
      </div>
      <div>
        <span>保证金余额</span>
        <b className="num">{uFmt(eq)}</b>
      </div>
      <div>
        <span>本局盈亏</span>
        <b className="num" style={{ color: rp >= 0 ? "var(--up)" : "var(--down)" }}>
          {sgnU(rp)}
        </b>
      </div>
      <div>
        <span>本局手续费</span>
        <b className="num">{uFmt(round.fees)}</b>
      </div>
      <div>
        <span>成交笔数</span>
        <b className="num">{round.fills.length}</b>
      </div>
    </div>
  );
}
