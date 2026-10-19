import { useNavigate } from "react-router";
import { FIXED } from "@/lib/constants";
import { equityAt, priceNow } from "@/lib/engine";
import { sgnU, uFmt } from "@/lib/format";
import { useTrainer } from "@/state/trainer";
import { Button } from "@/components/ui/button";

export function Readout() {
  const t = useTrainer();
  const nav = useNavigate();
  const done = t.log.filter((r) => r.fills > 0);
  const wins = done.filter((r) => r.pnl > 0).length;
  const live = t.round && !t.round.done ? equityAt(t.round, priceNow(t.round)) : t.acc.wallet;
  const rp = t.round && !t.round.done ? live - t.round.startWallet : null;
  const tot = t.log.reduce((a, r) => a + r.pnl, 0);
  const fee = t.log.reduce((a, r) => a + (r.fees || 0), 0);
  const up = "var(--up)";
  const down = "var(--down)";
  return (
    <header id="readout">
      <div className="metric quiet">
        <b>{uFmt(FIXED.account, 0)} U</b>
        <span>初始本金</span>
      </div>
      <div className="metric lead">
        <b style={{ color: live >= FIXED.account ? up : down }}>{uFmt(live)} U</b>
        <span>账户权益</span>
      </div>
      <div className="metric bal">
        <b style={{ color: rp == null ? "" : rp >= 0 ? up : down }}>{rp == null ? "—" : sgnU(rp)}</b>
        <span>本局盈亏</span>
      </div>
      <div className="rsep" />
      <div className="metric">
        <b>
          {t.acc.runN || 0}/{FIXED.runSize}
        </b>
        <span>本场进度</span>
      </div>
      <div className="metric">
        <b>{t.log.length}</b>
        <span>累计局数</span>
      </div>
      <div className="metric">
        <b>{done.length ? Math.round((wins / done.length) * 100) + "%" : "—"}</b>
        <span>胜率</span>
      </div>
      <div className="metric quiet">
        <b style={{ color: !t.log.length ? "" : tot >= 0 ? up : down }}>{t.log.length ? sgnU(tot) : "—"}</b>
        <span>累计盈亏</span>
      </div>
      <div className="metric quiet">
        <b>{uFmt(fee)}</b>
        <span>累计手续费</span>
      </div>
      <div className="spacer" />
      <Button variant="ghost" size="sm" onClick={() => nav("/stats")}>
        统计
      </Button>
      <Button variant="ghost" size="sm" onClick={() => nav("/settings")}>
        设置
      </Button>
      <Button variant="ghost" size="sm" onClick={() => nav("/help")}>
        说明
      </Button>
    </header>
  );
}
