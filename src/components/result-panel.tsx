import { TradePanel } from "@/components/trade-panel";
import { FIXED } from "@/lib/constants";
import { intervalLabel } from "@/lib/frames";
import { bjDate, fmtPrice, pctFmt, sgnU, uFmt } from "@/lib/format";
import { useTrainer } from "@/state/trainer";
import { Button } from "@/components/ui/button";

export function Side() {
  const t = useTrainer();
  return (
    <aside id="side">
      {t.phase === "trade" && t.round && <TradePanel key={t.round.startedAt} />}
      {t.phase === "result" && <ResultPanel />}
      {t.phase === "loading" && (
        <div>
          <div className="phase">抽取中</div>
          <p className="sheet-copy">{t.loadMsg}</p>
        </div>
      )}
      {t.phase === "error" && (
        <div>
          <div className="phase">拿不到行情</div>
          <p className="sheet-copy">没有拉到真实 K 线。换个网络，或把交易对收成 BTC 再试。</p>
        </div>
      )}
      {t.phase === "empty" && (
        <div>
          <div className="phase">准备</div>
          <p className="sheet-copy">点「开始第一局」抽一段行情。币种、日期和价格轴都会先藏起来。</p>
        </div>
      )}
    </aside>
  );
}

export function ResultPanel() {
  const t = useTrainer();
  const r = t.result?.rec;
  if (!r) return null;
  const col = r.pnl > 0 ? "var(--up)" : r.pnl < 0 ? "var(--down)" : "var(--dim)";
  const nextLabel = `下一局（本场第 ${(t.acc.runN || 0) + 1}/${FIXED.runSize} 局）`;
  return (
    <div>
      <div className="phase">本局结束 · 已揭盲</div>
      <div className="settle-hd" style={{ color: col }}>
        {(r.fills ? sgnU(r.pnl) : "0.00") + " U"}
      </div>
      <div className="reveal">
        {r.fills ? `${pctFmt(r.pnl / r.startW)} · 余额 ${uFmt(r.endW)} U` : `这一局没有交易 · 余额 ${uFmt(r.endW)} U`}
      </div>
      <div className="reveal reveal-date" style={{ color: "var(--chalk)" }}>
        标的已隐藏 · {intervalLabel(r.interval)} ·{" "}
        <span className="reveal-range">
          {bjDate(r.t0)} → {bjDate(r.t1)}
          <span className="reveal-tz">（北京时间）</span>
        </span>
      </div>
      {t.result?.bust && <div className="rs-bust">账户爆仓了。余额已经重新给到 10,000 U，爆仓次数记在统计里。</div>}
      <div className="plan">
        <div className="row">
          <span>结束方式</span>
          <b>
            {r.reason}
            {r.peeked ? " · 看过答案" : ""}
          </b>
        </div>
        <div className="row">
          <span>走了多少根</span>
          <b>{r.bars}</b>
        </div>
        <div className="row">
          <span>成交笔数</span>
          <b>{r.fills}</b>
        </div>
        <div className="row">
          <span>手续费</span>
          <b>{uFmt(r.fees)} U</b>
        </div>
        <div className="row">
          <span>本局最大回撤</span>
          <b>{(r.maxDD * 100).toFixed(2)}%</b>
        </div>
        {r.liqs > 0 && (
          <div className="row">
            <span>被强平</span>
            <b style={{ color: "var(--down)" }}>{r.liqs} 次</b>
          </div>
        )}
      </div>
      <div className="mb-2 text-[13px]">成交记录（#是开局后第几根）</div>
      <div id="rs-fills">
        {r.list.length === 0 && <div className="tr-empty">没有成交</div>}
        {r.list.map((f, i) => (
          <div className="rs-fill" key={i}>
            <span className="n">#{f.i}</span>
            <span className={`t ${f.side > 0 ? "l" : "s"}`}>{f.tag}</span>
            <span>{fmtPrice(f.price, null)}</span>
            <span>{uFmt(f.n, 0)} U</span>
            <span style={{ color: f.pnl > 0 ? "var(--up)" : f.pnl < 0 ? "var(--down)" : "var(--faint)" }}>
              {f.pnl ? sgnU(f.pnl) : ""}
            </span>
          </div>
        ))}
      </div>
      <Button className="mt-3 w-full" disabled={t.peeking} onClick={t.requestPeek}>
        揭示后面 300 根
      </Button>
      <Button variant="primary" className="mt-2 w-full" onClick={t.next}>
        {nextLabel}
      </Button>
    </div>
  );
}
