import { useState } from "react";
import { FEE_MAKER, FEE_TAKER, MMR } from "@/lib/constants";
import { availBal, equityAt, liqPrice, maxOpen, posIM, priceNow, uPnl } from "@/lib/engine";
import { blindBaseOf, fmtPrice, parsePrice, pctFmt, sgnU, uFmt } from "@/lib/format";
import type { OrderTab, Side } from "@/lib/types";
import { useTrainer } from "@/state/trainer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function TradePanel() {
  const t = useTrainer();
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

  return (
    <div>
      <div className="tr-top">
        <Button size="sm" disabled={locked} onClick={() => t.openDialog({ kind: "mode" })}>
          {t.acc.mode === "cross" ? "全仓" : "逐仓"}
        </Button>
        <Button size="sm" disabled={locked} onClick={() => t.openDialog({ kind: "lev" })}>
          {t.acc.lev}x
        </Button>
        <span className="tr-blind">盲测 · USDT 永续</span>
      </div>
      <Tabs value={t.tab} onValueChange={onTab}>
        <TabsList>
          <TabsTrigger value="market">市价</TabsTrigger>
          <TabsTrigger value="limit">限价</TabsTrigger>
        </TabsList>
      </Tabs>
      {t.tab === "limit" && (
        <div className="tr-field">
          <span>价格</span>
          <input value={limit} inputMode="decimal" autoComplete="off" onChange={(e) => setLimit(e.target.value)} />
          <Button variant="text" size="sm" className="text-verdict" onClick={() => setLimit(fmtPrice(p, base))}>
            最新
          </Button>
        </div>
      )}
      <div className="tr-last">
        最新价 <b className="num">{fmtPrice(p, base)}</b>
      </div>
      <div className="tr-field">
        <span>数量</span>
        <input
          value={amt}
          inputMode="decimal"
          placeholder="仓位价值"
          autoComplete="off"
          onChange={(e) => {
            setAmt(e.target.value);
            setPct(0);
          }}
        />
        <em>USDT</em>
      </div>
      <div className="tr-pctrow">
        <Slider value={[pct]} max={100} step={1} onValueChange={([v]) => applyPct(v ?? 0)} />
        <span className="num w-9 text-right text-[11px] text-dim">{pct}%</span>
      </div>
      <div className="tr-ticks">
        {[10, 25, 50, 75, 100].map((n) => (
          <button key={n} type="button" onClick={() => applyPct(n)}>
            {n}%
          </button>
        ))}
      </div>
      <div className="tr-kv">
        <span>可用</span>
        <b>{uFmt(availBal(round, p))} USDT</b>
      </div>
      <Label className="mb-2 flex items-center gap-2 text-[12.5px]">
        <Checkbox checked={tpslOn} onCheckedChange={(v) => setTpslOn(v === true)} />
        止盈 / 止损
      </Label>
      {tpslOn && (
        <>
          <div className="tr-field">
            <span>止盈</span>
            <input value={tp} inputMode="decimal" placeholder="触发价" autoComplete="off" onChange={(e) => setTp(e.target.value)} />
          </div>
          <div className="tr-field">
            <span>止损</span>
            <input value={sl} inputMode="decimal" placeholder="触发价" autoComplete="off" onChange={(e) => setSl(e.target.value)} />
          </div>
        </>
      )}
      <div className="tr-btns">
        <Button variant="buy" size="lg" className="btn-buy" onClick={() => send(1)}>
          买入 / 做多
        </Button>
        <Button variant="sell" size="lg" className="btn-sell" onClick={() => send(-1)}>
          卖出 / 做空
        </Button>
      </div>
      <div className="tr-under">
        <div>
          可开多 <b>{uFmt(maxOpen(round, 1, t.acc.lev), 0)}</b> U
        </div>
        <div className="text-right">
          可开空 <b>{uFmt(maxOpen(round, -1, t.acc.lev), 0)}</b> U
        </div>
        <div>
          保证金 <b>{uFmt(notional / t.acc.lev)}</b> U
        </div>
        <div className="text-right">
          手续费 ≈ <b>{uFmt(notional * rate)}</b> U
        </div>
      </div>

      <div className="tr-sec">
        <b>持仓</b>
      </div>
      {!P && <div className="tr-empty">没有持仓</div>}
      {P && (
        <Position
          onEdit={() => t.openDialog({ kind: "tpsl" })}
          onClose={(f) => t.closePart(f)}
          onReverse={t.reverse}
        />
      )}

      <div className="tr-sec">
        <b>
          当前委托 <i>{round.orders.length ? `(${round.orders.length})` : ""}</i>
        </b>
        {round.orders.length > 0 && (
          <Button variant="text" size="sm" className="text-dim hover:text-breach" onClick={t.cancelAll}>
            全部撤销
          </Button>
        )}
      </div>
      {round.orders.length === 0 && <div className="tr-empty">没有挂单</div>}
      {round.orders.map((o) => (
        <div className="tr-order" key={o.id}>
          <span className={`tr-side ${o.side > 0 ? "l" : "s"}`}>{o.side > 0 ? "买" : "卖"}</span>
          <span>
            限价 <b className="num">{fmtPrice(o.price, base)}</b>
          </span>
          <span className="num">
            {uFmt(o.qty * o.price, 0)} U{o.tp || o.sl ? " · 带止盈止损" : ""}
          </span>
          <Button variant="text" size="sm" className="grow text-verdict" onClick={() => t.cancel(o.id)}>
            撤单
          </Button>
        </div>
      ))}

      <div className="tr-sec">
        <b>账户</b>
      </div>
      <AccountGrid />
      <Button className="mt-4 w-full" onClick={t.requestEnd}>
        结束本局
      </Button>
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
        <span className={`tr-side ${P.side > 0 ? "l" : "s"}`}>{P.side > 0 ? "多" : "空"}</span>
        <span className="tr-tag">
          {P.mode === "cross" ? "全仓" : "逐仓"} {P.lev}x
        </span>
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
          <b className="num" style={{ color: "#B5651D" }}>
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
        <Button variant="text" size="sm" className="text-verdict" onClick={onEdit}>
          设置
        </Button>
      </div>
      <div className="tr-closebar">
        <Button size="sm" onClick={() => onClose(0.25)}>
          平 25%
        </Button>
        <Button size="sm" onClick={() => onClose(0.5)}>
          平 50%
        </Button>
        <Button size="sm" className="!border-chalk !bg-chalk !text-white" onClick={() => onClose(1)}>
          市价全平
        </Button>
        <Button size="sm" onClick={onReverse}>
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
