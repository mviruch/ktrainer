import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { FEE_TAKER, FIXED, IV_CN, IV_OK, LEV_CHIPS, LEV_MAX, POOLS, SPEED_MAX, SPEED_MIN } from "@/lib/constants";
import { availBal, priceNow } from "@/lib/engine";
import { bjDate, fmtPrice, parsePrice, sgnU, uFmt } from "@/lib/format";
import { download, statsOf } from "@/lib/stats";
import { store } from "@/lib/store";
import type { Pool } from "@/lib/types";
import { useTrainer } from "@/state/trainer";

function isPool(v: string): v is Pool {
  return v in POOLS;
}

export function RouteSheets() {
  const loc = useLocation();
  const nav = useNavigate();
  const close = () => nav("/");
  const name = loc.pathname === "/stats" ? "stats" : loc.pathname === "/settings" ? "settings" : loc.pathname === "/help" ? "help" : null;
  return (
    <>
      <Dialog open={name === "stats"} onOpenChange={(o) => !o && close()}>
        {name === "stats" && <StatsBody onClose={close} />}
      </Dialog>
      <Dialog open={name === "settings"} onOpenChange={(o) => !o && close()}>
        {name === "settings" && <SettingsBody onClose={close} />}
      </Dialog>
      <Dialog open={name === "help"} onOpenChange={(o) => !o && close()}>
        {name === "help" && <HelpBody onClose={close} />}
      </Dialog>
    </>
  );
}

function StatsBody({ onClose }: { onClose: () => void }) {
  const t = useTrainer();
  const s = statsOf(t.log);
  function csv() {
    const cols = ["ts", "symbol", "interval", "t0", "t1", "bars", "fills", "startW", "endW", "pnl", "fees", "maxDD", "liqs", "reason", "peeked"] as const;
    const q = (v: unknown) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [cols.join(",")].concat(
      t.log.map((r) =>
        cols
          .map((c) => q(c === "ts" ? new Date(r.ts).toISOString() : c === "t0" || c === "t1" ? bjDate(r[c]) : r[c]))
          .join(","),
      ),
    );
    download("合约训练记录.csv", "\uFEFF" + lines.join("\n"), "text/csv;charset=utf-8");
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>统计</DialogTitle>
        <DialogDescription>
          {s.n ? `${s.n} 局（其中 ${s.traded} 局有交易）。${s.n < 40 ? "样本还少，先多打几场再下结论。" : ""}` : "还没有完成的局。"}
        </DialogDescription>
      </DialogHeader>
      {s.n > 0 && (
        <>
          <h3 className="sheet-h">账户</h3>
          <div className="field"><span>当前余额</span><b className="num">{uFmt(t.acc.wallet)} U</b></div>
          <div className="field"><span>累计盈亏（已扣手续费）</span><b className="num" style={{ color: s.pnl >= 0 ? "var(--up)" : "var(--down)" }}>{sgnU(s.pnl)} U</b></div>
          <div className="field"><span>累计手续费</span><b className="num">{uFmt(s.fees)} U{s.gross > 0 ? ` · 占毛利 ${Math.round((s.fees / s.gross) * 100)}%` : ""}</b></div>
          <div className="field"><span>爆仓 / 被强平</span><b className="num">{t.acc.busts || 0} 次 / {s.liqs} 次</b></div>
          <h3 className="sheet-h">每局</h3>
          <div className="field"><span>胜率（有交易的局）</span><b className="num">{s.traded ? Math.round((s.wins / s.traded) * 100) + "%" : "—"}</b></div>
          <div className="field"><span>平均盈利局 / 平均亏损局</span><b className="num">{s.avgW == null ? "—" : "+" + uFmt(s.avgW)} / {s.avgL == null ? "—" : "-" + uFmt(s.avgL)}</b></div>
          <div className="field"><span>盈亏比</span><b className="num">{s.avgW != null && s.avgL ? (s.avgW / s.avgL).toFixed(2) : "—"}</b></div>
          <div className="field"><span>利润因子</span><b className="num">{s.pf == null ? "—" : s.pf.toFixed(2)}</b></div>
          <div className="field"><span>最好 / 最差一局</span><b className="num">{s.best == null ? "—" : sgnU(s.best)} / {s.worst == null ? "—" : sgnU(s.worst)}</b></div>
          {s.peeked > 0 && <div className="field"><span>中途揭示答案的局</span><b className="num">{s.peeked}</b></div>}
          <h3 className="sheet-h">按周期</h3>
          {IV_OK.map((iv) => {
            const rows = t.log.filter((r) => r.interval.split(",").includes(iv));
            if (!rows.length) return null;
            const x = statsOf(rows);
            return (
              <div className="field" key={iv}>
                <span>{IV_CN[iv]}</span>
                <b className="num">{x.n} 局 · {sgnU(x.pnl)} U{x.traded ? ` · 胜率 ${Math.round((x.wins / x.traded) * 100)}%` : ""}</b>
              </div>
            );
          })}
          {t.runs.length > 0 && <h3 className="sheet-h">场次</h3>}
          {t.runs.slice(-12).map((r) => (
            <div className="field" key={r.idx}>
              <span>第 {r.idx} 场</span>
              <b className="num">{sgnU(r.pnl)} U · 胜率 {r.traded ? Math.round((r.wins / r.traded) * 100) + "%" : "—"} · 余额 {uFmt(r.endW, 0)}</b>
            </div>
          ))}
        </>
      )}
      <DialogFooter>
        <Button onClick={csv} disabled={!s.n}>导出 CSV</Button>
        <Button
          disabled={!s.n}
          onClick={() => download("合约训练记录.json", JSON.stringify({ account: t.acc, runs: t.runs, rounds: t.log }, null, 2), "application/json")}
        >
          导出 JSON
        </Button>
        <Button onClick={() => t.openDialog({ kind: "wipe" })}>清空记录</Button>
        <Button variant="primary" className="ml-auto" onClick={onClose}>关闭</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function SettingsBody({ onClose }: { onClose: () => void }) {
  const t = useTrainer();
  const [pool, setPool] = useState(t.cfg.pool);
  const [ivs, setIvs] = useState(t.cfg.intervals.split(","));
  const [green, setGreen] = useState(t.cfg.greenUp);
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>设置</DialogTitle>
        <DialogDescription>交易对和周期从下一局开始生效。勾上的周期会同时出现在一局里，播放和撮合走最短的那档。</DialogDescription>
      </DialogHeader>
      <h3 className="sheet-h">交易对</h3>
      <div className="cfg-chips">
        {Object.entries(POOLS).map(([k, v]) => (
          <Button key={k} size="sm" variant={pool === k ? "primary" : "default"} onClick={() => isPool(k) && setPool(k)}>
            {v.name}
          </Button>
        ))}
      </div>
      <p className="hint">成交量排行按币安 U 本位合约 24 小时成交额现取，12 小时更新一次。</p>
      <h3 className="sheet-h">周期</h3>
      <div className="flex flex-wrap gap-4">
        {IV_OK.map((iv) => (
          <Label key={iv} className="flex items-center gap-2">
            <Checkbox
              checked={ivs.includes(iv)}
              onCheckedChange={(on) => setIvs((cur) => (on ? [...cur, iv] : cur.filter((x) => x !== iv)))}
            />
            {IV_CN[iv]}
          </Label>
        ))}
      </div>
      <p className="hint">同一局一起看。长周期对齐到最短周期的当前时刻，没收盘的柱子只用已经走过的 K 线拼，不会把后面的价格画出来。</p>
      <h3 className="sheet-h">显示</h3>
      <div className="field">
        <span>涨跌配色</span>
        <select className="h-8 rounded-[3px] border border-line bg-ink px-2" value={green ? "1" : "0"} onChange={(e) => setGreen(e.target.value === "1")}>
          <option value="1">绿涨红跌</option>
          <option value="0">红涨绿跌</option>
        </select>
      </div>
      <h3 className="sheet-h">固定规则</h3>
      <div className="cfg-fixed">
        <div><span>初始本金</span><b>10,000 U，一直滚动；爆仓或手动重置才回到 1 万</b></div>
        <div><span>一场</span><b>{FIXED.runSize} 局</b></div>
        <div><span>手续费</span><b>市价 / 止盈止损 万 5，限价挂单成交 万 2</b></div>
        <div><span>滑点</span><b>市价成交 BTC、ETH 万 1，其他币 万 3；跳空按开盘价</b></div>
        <div><span>保证金</span><b>全仓 / 逐仓，1–125x，维持保证金率 0.5%</b></div>
        <div><span>开局揭示</span><b>起点之前最多 {FIXED.ctxMax} 根</b></div>
        <div><span>揭示答案</span><b>后面 {FIXED.peekBars} 根</b></div>
        <div><span>图表</span><b>盲轴（开局收盘 = 100）、对数刻度、成交量按均量倍数</b></div>
      </div>
      <Separator className="my-4" />
      <div className="field">
        <span>余额 {uFmt(t.acc.wallet)} U</span>
        <Button size="sm" onClick={() => t.openDialog({ kind: "reset" })}>余额重置为 10,000 U</Button>
      </div>
      <p className="sheet-copy mt-2">
        {store.persistent
          ? "记录保存在本机浏览器里。换浏览器或清缓存会丢，可以在统计里导出。"
          : "当前环境不允许本地存储，记录只在本页有效。"}
      </p>
      <DialogFooter>
        <Button
          variant="primary"
          onClick={() => {
            if (!ivs.length) {
              t.toastMsg("至少留一个周期", 2500);
              return;
            }
            t.saveConfig({ pool, intervals: ivs.join(","), greenUp: green });
            onClose();
          }}
        >
          保存
        </Button>
        <Button onClick={onClose}>取消</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function HelpBody({ onClose }: { onClose: () => void }) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>怎么用</DialogTitle>
        <DialogDescription>
          每一局随机抽一个币安 U 本位永续和一段历史行情。开局那根收盘记作 100，105 就是比开局高 5%。结束本局后揭盲，显示真实币种、时间和价格。
        </DialogDescription>
      </DialogHeader>
      <h3 className="sheet-h">播放</h3>
      <p className="sheet-copy">空格播放 / 暂停，→ 走一根最短周期。速度 3–10 秒一根。图上方切换周期，它们跟到同一时刻。播放中可以下单、平仓、加仓。</p>
      <h3 className="sheet-h">下单</h3>
      <p className="sheet-copy">全仓 / 逐仓和杠杆在面板顶部，有持仓或挂单时不能改。市价按最新价成交，万 5，带滑点。限价碰到才成交，万 2；价格已经穿过最新价就按市价吃单。</p>
      <p className="sheet-copy">数量填的是仓位价值（USDT）。单向持仓：同向加仓摊均价，反向先平再反手。止盈止损触发后市价平掉整个仓位。强平按维持保证金率 0.5% 算，橙色虚线。</p>
      <h3 className="sheet-h">一局、一场</h3>
      <p className="sheet-copy">结束本局才会结算：持仓市价平掉，挂单撤销，然后揭盲。还没交易可以换一段，不算局数。{FIXED.runSize} 局算一场。本金一直滚动，余额不到 1 U 记一次爆仓并重新给 10,000 U。</p>
      <h3 className="sheet-h">撮合</h3>
      <p className="sheet-copy">只有开高低收。阳线按开→低→高→收，阴线按开→高→低→收。挂单、止损、止盈、强平谁先被碰到谁先处理。跳空越过的价位按开盘价成交。</p>
      <h3 className="sheet-h">图表</h3>
      <p className="sheet-copy">滚轮缩放，拖拽平移。F 适应全部。左边可以画趋势线、射线、水平线和斐波那契，Esc 取消。图上方打开指标，按类型选，点一下加到主图或副图，参数在那张图上改。指标用 TA-Lib，只吃已经走出的 K 线。揭盲前不显示时间轴，成交量用相对均量，避免从成交量认出币种。</p>
      <DialogFooter>
        <Button variant="primary" className="ml-auto" onClick={onClose}>知道了</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function ActionSheets() {
  const t = useTrainer();
  const d = t.dialog;
  return (
    <>
      <LevSheet />
      <ModeSheet />
      <TpSlSheet />
      <Dialog open={d?.kind === "end"} onOpenChange={(o) => !o && t.closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>结束本局？</DialogTitle>
            <DialogDescription>
              {t.round?.pos ? "持仓会按市价平掉（吃单万 5，带滑点）。" : ""}
              {t.round?.orders.length ? "挂单会全部撤销。" : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="primary" onClick={t.confirmEnd}>结束本局</Button>
            <Button className="ml-auto" onClick={t.closeDialog}>继续交易</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={d?.kind === "peek"} onOpenChange={(o) => !o && t.closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>揭示后面 {FIXED.peekBars} 根？</DialogTitle>
            <DialogDescription>
              揭示会先结束本局：持仓按市价平掉、挂单撤销，盈亏照算，这一局标记为「看过答案」。然后把后面 {FIXED.peekBars} 根画出来。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="primary" onClick={t.confirmPeek}>结束并揭示</Button>
            <Button className="ml-auto" onClick={t.closeDialog}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SpeedSheet />
      <Dialog open={d?.kind === "wipe"} onOpenChange={(o) => !o && t.closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空记录</DialogTitle>
            <DialogDescription>清空全部记录和场次，余额回到 10,000 U。不能恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="primary"
              onClick={() => {
                const res = t.wipe();
                if (!res.ok) t.toastMsg(res.error, 3000);
              }}
            >
              清空
            </Button>
            <Button className="ml-auto" onClick={t.closeDialog}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={d?.kind === "reset"} onOpenChange={(o) => !o && t.closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置余额</DialogTitle>
            <DialogDescription>余额重置为 10,000 U。记录不会删。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="primary"
              onClick={() => {
                const res = t.resetWallet();
                if (!res.ok) t.toastMsg(res.error, 3200);
              }}
            >
              重置
            </Button>
            <Button className="ml-auto" onClick={t.closeDialog}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={d?.kind === "run"} onOpenChange={(o) => !o && t.closeDialog()}>
        {d?.kind === "run" && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>第 {d.run.idx} 场结束（{d.run.n} 局）</DialogTitle>
              <DialogDescription>本场净盈亏，已扣手续费。</DialogDescription>
            </DialogHeader>
            <div className="num text-[40px] leading-none" style={{ color: d.run.pnl >= 0 ? "var(--up)" : "var(--down)" }}>
              {sgnU(d.run.pnl)} U
            </div>
            <div className="field"><span>余额</span><b className="num">{uFmt(d.run.startW)} → {uFmt(d.run.endW)} U</b></div>
            <div className="field"><span>有交易的局 / 盈利的局</span><b className="num">{d.run.traded} / {d.run.wins}{d.run.traded ? `（胜率 ${Math.round((d.run.wins / d.run.traded) * 100)}%）` : ""}</b></div>
            <div className="field"><span>最好 / 最差一局</span><b className="num"><span style={{ color: "var(--up)" }}>{sgnU(d.run.best)}</span> / <span style={{ color: "var(--down)" }}>{sgnU(d.run.worst)}</span></b></div>
            <div className="field"><span>手续费</span><b className="num">{uFmt(d.run.fees)} U</b></div>
            {d.run.liqs > 0 && <div className="field"><span>被强平</span><b className="num" style={{ color: "var(--down)" }}>{d.run.liqs} 次</b></div>}
            <DialogFooter>
              <Button variant="primary" onClick={t.closeDialog}>知道了</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function LevSheet() {
  const t = useTrainer();
  const open = t.dialog?.kind === "lev";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && t.closeDialog()}>
      {open && <LevForm />}
    </Dialog>
  );
}

function LevForm() {
  const t = useTrainer();
  const [lev, setLev] = useState(t.acc.lev);
  const avail = t.round && !t.round.done ? availBal(t.round) : t.acc.wallet;
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>调整杠杆</DialogTitle>
        <DialogDescription>按当前可用 {uFmt(avail, 0)} U，最多能开约 {uFmt(avail * lev, 0)} U 的仓位。</DialogDescription>
      </DialogHeader>
      <div className="num mb-3 text-center text-[34px]">{lev}x</div>
      <Slider min={1} max={LEV_MAX} step={1} value={[lev]} onValueChange={([v]) => setLev(v ?? 1)} />
      <div className="cfg-chips mt-3">
        {LEV_CHIPS.map((n) => (
          <Button key={n} size="sm" variant={lev === n ? "primary" : "default"} onClick={() => setLev(n)}>
            {n}x
          </Button>
        ))}
      </div>
      {lev >= 20 && <p className="hint">价格反向走约 {(100 / lev - 0.5).toFixed(1)}% 就会被强平（逐仓满仓时）。</p>}
      <DialogFooter>
        <Button variant="primary" onClick={() => t.setLev(lev)}>确定</Button>
        <Button className="ml-auto" onClick={t.closeDialog}>取消</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ModeSheet() {
  const t = useTrainer();
  const open = t.dialog?.kind === "mode";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && t.closeDialog()}>
      {open && <ModeForm />}
    </Dialog>
  );
}

function ModeForm() {
  const t = useTrainer();
  const [mode, setMode] = useState(t.acc.mode);
  return (
    <DialogContent>
        <DialogHeader>
          <DialogTitle>保证金模式</DialogTitle>
          <DialogDescription>全仓用整个账户当保证金。逐仓只用开仓时放进去的保证金。</DialogDescription>
        </DialogHeader>
        <div className="cfg-chips">
          <Button variant={mode === "cross" ? "primary" : "default"} onClick={() => setMode("cross")}>全仓</Button>
          <Button variant={mode === "isolated" ? "primary" : "default"} onClick={() => setMode("isolated")}>逐仓</Button>
        </div>
        <p className="sheet-copy mt-3">全仓：浮亏一直吃账户，强平就是整个账户爆掉。逐仓：强平最多亏掉这个仓位的保证金。</p>
        <DialogFooter>
          <Button variant="primary" onClick={() => t.setMode(mode)}>确定</Button>
          <Button className="ml-auto" onClick={t.closeDialog}>取消</Button>
        </DialogFooter>
    </DialogContent>
  );
}

function TpSlSheet() {
  const t = useTrainer();
  const open = t.dialog?.kind === "tpsl" && !!t.round?.pos;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && t.closeDialog()}>
      {open && <TpSlForm />}
    </Dialog>
  );
}

function TpSlForm() {
  const t = useTrainer();
  const round = t.round;
  const P = round?.pos;
  const base = round && !round.done ? round.bars[round.ctx - 1]?.c || null : null;
  const [tp, setTp] = useState(P?.tp ? fmtPrice(P.tp, base) : "");
  const [sl, setSl] = useState(P?.sl ? fmtPrice(P.sl, base) : "");
  const p = round && !round.done ? priceNow(round) : 0;
  const est = (v: number) => (P && v > 0 ? sgnU(P.side * P.qty * (v - P.entry) - P.qty * v * FEE_TAKER) + " U" : "—");
  const tpReal = parsePrice(tp, base);
  const slReal = parsePrice(sl, base);
  return (
    <DialogContent>
        <DialogHeader>
          <DialogTitle>止盈止损 · {P && P.side > 0 ? "多" : "空"}仓</DialogTitle>
          <DialogDescription>按最新价触发，触发后市价平掉整个仓位。不填就是不设。</DialogDescription>
        </DialogHeader>
        <div className="field"><span>最新价</span><b className="num">{fmtPrice(p, base)}</b></div>
        <div className="field"><span>开仓均价</span><b className="num">{P ? fmtPrice(P.entry, base) : "—"}</b></div>
        <Label className="mt-2 block">止盈触发价</Label>
        <Input className="mt-1" value={tp} inputMode="decimal" onChange={(e) => setTp(e.target.value)} />
        <Label className="mt-3 block">止损触发价</Label>
        <Input className="mt-1" value={sl} inputMode="decimal" onChange={(e) => setSl(e.target.value)} />
        <p className="hint">按现在的仓位估算：止盈 {est(tpReal)}，止损 {est(slReal)}（已扣平仓手续费，没算滑点）</p>
        <DialogFooter>
          <Button
            variant="primary"
            onClick={() => t.applyTpSl(tp.trim() ? parsePrice(tp, base) : null, sl.trim() ? parsePrice(sl, base) : null)}
          >
            确定
          </Button>
          <Button onClick={() => t.applyTpSl(null, null)}>全部清除</Button>
          <Button className="ml-auto" onClick={t.closeDialog}>取消</Button>
        </DialogFooter>
    </DialogContent>
  );
}

function SpeedSheet() {
  const t = useTrainer();
  const open = t.dialog?.kind === "speed";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && t.closeDialog()}>
      {open && <SpeedForm />}
    </Dialog>
  );
}

function SpeedForm() {
  const t = useTrainer();
  const [v, setV] = useState(String(t.speed));
  return (
    <DialogContent>
        <DialogHeader>
          <DialogTitle>播放速度</DialogTitle>
          <DialogDescription>每根 K 线停多少秒。最快 {SPEED_MIN} 秒，最慢 {SPEED_MAX} 秒，可以填小数。</DialogDescription>
        </DialogHeader>
        <Input value={v} inputMode="decimal" onChange={(e) => setV(e.target.value)} />
        <DialogFooter>
          <Button
            variant="primary"
            onClick={() => {
              const n = parseFloat(v);
              if (!(n >= SPEED_MIN && n <= SPEED_MAX)) {
                t.toastMsg("填 3 到 10 之间的数");
                return;
              }
              t.setSpeed(n);
              t.closeDialog();
            }}
          >
            确定
          </Button>
          <Button className="ml-auto" onClick={t.closeDialog}>取消</Button>
        </DialogFooter>
    </DialogContent>
  );
}
