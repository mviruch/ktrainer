import { useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FEE_TAKER, FIXED, IV_CN, IV_OK, LEV_CHIPS, LEV_MAX, POOLS, SPEED_MAX, SPEED_MIN } from "@/lib/constants";
import { availBal, opp, priceNow, slipPx, uPnl } from "@/lib/engine";
import { bjDate, fmtPrice, parsePrice, sgnU, uFmt, filterDecimal } from "@/lib/format";
import { download, statsOf } from "@/lib/stats";
import { exportJson } from "@/lib/export-json";
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

function StatsBody(_props: { onClose: () => void }) {
  const t = useTrainer();
  const s = statsOf(t.log);
  function csv() {
    const cols = ["ts", "symbol", "interval", "t0", "t1", "bars", "fills", "startW", "endW", "pnl", "fees", "maxDD", "liqs", "reason", "peeked"] as const;
    const q = (v: unknown) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [cols.join(",")].concat(
      t.log.map((r) =>
        cols
          .map((c) => q(c === "symbol" ? (r.revealed === true ? r.symbol : "HIDDEN") : c === "ts" ? new Date(r.ts).toISOString() : c === "t0" || c === "t1" ? (r.revealed === true ? bjDate(r[c]) : "HIDDEN") : r[c]))
          .join(","),
      ),
    );
    download("合约训练记录.csv", "\uFEFF" + lines.join("\n"), "text/csv;charset=utf-8");
  }
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");
  const tone = (v: number | null | undefined) => (v == null || v === 0 ? "" : v > 0 ? "text-up" : "text-down");
  const kpi = (label: string, value: ReactNode, sub?: ReactNode, cls = "") => (
    <div className="flex min-w-0 flex-col gap-1 rounded-[4px] bg-ink px-3 py-2.5">
      <span className="text-[11px] text-fg-3">{label}</span>
      <b className={`num truncate text-[18px] leading-6 font-semibold ${cls}`}>{value}</b>
      {sub ? <span className="num text-[11px] text-fg-3">{sub}</span> : null}
    </div>
  );
  const runN = t.acc.runN || 0;
  const cur = runN > 0 ? statsOf(t.log.slice(-runN)) : null;
  const runRows = [
    ...(cur ? [{ key: "cur", label: `#${t.runs.length + 1} 进行中`, sub: `${runN}/${FIXED.runSize}`, n: cur.n, wr: pct(cur.wins, cur.traded), pnl: cur.pnl }] : []),
    ...t.runs
      .slice()
      .reverse()
      .map((r) => ({ key: String(r.idx), label: `#${r.idx} 已结束`, sub: "", n: r.n, wr: pct(r.wins, r.traded), pnl: r.pnl })),
  ];
  const runTable = (rows: typeof runRows) => (
    <div className="overflow-hidden rounded-[4px] border border-line">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-3">场次状态</TableHead>
            <TableHead className="text-right">局</TableHead>
            <TableHead className="text-right">胜率</TableHead>
            <TableHead className="pr-3 text-right">净盈亏</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="num pl-3">
                {r.label}
                {r.sub ? <span className="ml-1 text-fg-3">· {r.sub}</span> : null}
              </TableCell>
              <TableCell className="num text-right">{r.n}</TableCell>
              <TableCell className="num text-right">{r.wr}</TableCell>
              <TableCell className={`num pr-3 text-right ${tone(r.pnl)}`}>{sgnU(r.pnl)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
  return (
    <DialogContent className="w-[min(640px,calc(100%-32px))]">
      <DialogHeader>
        <DialogTitle>统计</DialogTitle>
        <DialogDescription className="sr-only">训练统计</DialogDescription>
      </DialogHeader>
      {s.n === 0 ? (
        <p className="py-6 text-center text-[12px] text-fg-3">还没有完成的局。</p>
      ) : (
        <Tabs defaultValue="all" className="flex flex-col gap-4">
          <TabsList variant="segmented" className="grid w-full grid-cols-3">
            <TabsTrigger value="all">总览</TabsTrigger>
            <TabsTrigger value="iv">按周期</TabsTrigger>
            <TabsTrigger value="runs">场次</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-2">
              {kpi("累计盈亏（已扣手续费）", sgnU(s.pnl), null, tone(s.pnl))}
              {kpi("胜率（有交易的局）", pct(s.wins, s.traded), `${s.wins} / ${s.traded}`)}
              {kpi("盈亏比", s.avgW != null && s.avgL ? (s.avgW / s.avgL).toFixed(2) : "—")}
              {kpi("利润因子", s.pf == null ? "—" : s.pf.toFixed(2))}
              {kpi("累计手续费", s.fees ? "-" + uFmt(s.fees) : uFmt(0), s.gross > 0 ? `占毛利 ${((s.fees / s.gross) * 100).toFixed(1)}%` : null, "text-fg-2")}
              {kpi("最好 / 最差一局", `${s.best == null ? "—" : sgnU(s.best).replace(/\.\d+$/, "")} / ${s.worst == null ? "—" : sgnU(s.worst).replace(/\.\d+$/, "")}`)}
              {kpi("爆仓 / 被强平", `${t.acc.busts || 0} / ${s.liqs} 次`)}
              {kpi("看过答案", `${s.peeked} 局`)}
            </div>
            {runRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-[12px] font-medium">场次</div>
                {runTable(runRows.slice(0, 3))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="iv">
            <div className="overflow-hidden rounded-[4px] border border-line">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-3">周期</TableHead>
                    <TableHead className="text-right">局</TableHead>
                    <TableHead className="text-right">胜率</TableHead>
                    <TableHead className="pr-3 text-right">净盈亏</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {IV_OK.map((iv) => {
                    const rows = t.log.filter((r) => r.interval.split(",").includes(iv));
                    if (!rows.length) return null;
                    const x = statsOf(rows);
                    return (
                      <TableRow key={iv}>
                        <TableCell className="pl-3">{IV_CN[iv]}</TableCell>
                        <TableCell className="num text-right">{x.n}</TableCell>
                        <TableCell className="num text-right">{pct(x.wins, x.traded)}</TableCell>
                        <TableCell className={`num pr-3 text-right ${tone(x.pnl)}`}>{sgnU(x.pnl)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="runs">{runRows.length ? runTable(runRows) : <p className="text-[12px] text-fg-3">还没有场次。</p>}</TabsContent>
        </Tabs>
      )}
      <p className="mt-4 text-[11px] leading-[18px] text-fg-3">
        {s.n ? `${s.n} 局（其中 ${s.traded} 局有交易）。` : ""}
        {s.n && s.n < 40 ? "样本还少，先多打几场再下结论。" : ""}
        {store.persistent ? "记录保存在本机浏览器里。" : "当前环境不允许本地存储，记录只在本页有效。"}
      </p>
      <DialogFooter>
        <Button variant="danger" className="mr-auto" onClick={() => t.openDialog({ kind: "wipe" })}>清空记录</Button>
        <Button
          variant="secondary"
          disabled={!s.n}
          onClick={() => download("合约训练记录.json", exportJson(t.acc, t.runs, t.log), "application/json")}
        >
          导出 JSON
        </Button>
        <Button variant="secondary" disabled={!s.n} onClick={() => void t.exportReview()}>
          复盘详细导出
        </Button>
        <Button variant="primary" onClick={csv} disabled={!s.n}>导出 CSV</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function SettingsBody({ onClose }: { onClose: () => void }) {
  const t = useTrainer();
  const [pool, setPool] = useState(t.cfg.pool);
  const [ivs, setIvs] = useState(t.cfg.intervals.split(","));
  const [green, setGreen] = useState(t.cfg.greenUp);
  const [fillSound, setFillSound] = useState(t.cfg.fillSound !== false);
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
      <h3 className="sheet-h">涨跌配色</h3>
      <ToggleGroup type="single" value={green ? "1" : "0"} onValueChange={(v) => v && setGreen(v === "1")} className="grid grid-cols-2 gap-2" aria-label="涨跌配色">
        {[
          { v: "1", label: "绿涨红跌", a: "#37a74c", b: "#cf4f5f" },
          { v: "0", label: "红涨绿跌", a: "#cf4f5f", b: "#37a74c" },
        ].map((o) => (
          <ToggleGroupItem
            key={o.v}
            value={o.v}
            className="h-10 justify-start gap-2 border border-line-strong px-3 data-[state=on]:border-brand data-[state=on]:bg-brand/15"
          >
            <span className="flex gap-0.5">
              <i className="block h-4 w-2 rounded-[1px]" style={{ background: o.a }} />
              <i className="block h-4 w-2 rounded-[1px]" style={{ background: o.b }} />
            </span>
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <h3 className="sheet-h">音效</h3>
      <Label className="flex items-center justify-between gap-3 text-[13px]">
        <span>成交音效</span>
        <Switch checked={fillSound} onCheckedChange={setFillSound} aria-label="成交音效" />
      </Label>
      <p className="hint">下单、平仓、止盈止损、强平等成交时播放短音效。手机浏览器需先点一下页面才能出声。</p>
      <h3 className="sheet-h">固定规则</h3>
      <div className="cfg-fixed">
        <div><span>初始本金</span><b>10,000 U，一直滚动；爆仓或手动重置才回到 1 万</b></div>
        <div><span>一场</span><b>{FIXED.runSize} 局</b></div>
        <div><span>手续费</span><b>市价 / 止盈止损 万 5，限价挂单成交 万 2</b></div>
        <div><span>滑点</span><b>市价成交 BTC、ETH 万 1，其他币 万 3；跳空按开盘价</b></div>
        <div><span>保证金</span><b>全仓 / 逐仓，1–125x，维持保证金率 0.5%</b></div>
        <div><span>开局揭示</span><b>起点之前最多 {FIXED.ctxMax} 根</b></div>
        <div><span>图表</span><b>盲轴（开局收盘 = 100）、对数刻度、成交量按均量倍数</b></div>
      </div>
      <Separator className="my-4" />
      <div className="field">
        <span>余额 {uFmt(t.acc.wallet)} U</span>
        <Button size="sm" variant="danger" onClick={() => t.openDialog({ kind: "reset" })}>余额重置为 10,000 U</Button>
      </div>
      <p className="sheet-copy mt-2">
        {store.persistent
          ? "记录保存在本机浏览器里。换浏览器或清缓存会丢，可以在统计里导出。"
          : "当前环境不允许本地存储，记录只在本页有效。"}
      </p>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          onClick={() => {
            if (!ivs.length) {
              t.toastMsg("至少留一个周期", 2500);
              return;
            }
            t.saveConfig({ pool, intervals: ivs.join(","), greenUp: green, fillSound });
            onClose();
          }}
        >
          保存
        </Button>
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
          每一局随机抽一个币安 U 本位永续和一段历史行情。开局那根收盘记作 100，105 就是比开局高 5%。结束本局后自动揭盲，显示真实时间和价格；标的仍隐藏，真实标的只在导出的 CSV 里。
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
      <p className="sheet-copy">滚轮缩放，拖拽平移。F 适应全部。左边可以画趋势线、射线、水平线和斐波那契，Esc 取消。图上方打开指标，按类型选，点一下加到主图或副图，参数在那张图上改。指标用 TA-Lib，只吃已经走出的 K 线。</p>
      <h3 className="sheet-h">脱敏</h3>
      <p className="sheet-copy">盲测中标的、日历时间和绝对价格都先藏起来：开局那根收盘记作 100，纵轴是相对开局的百分比；时间轴显示相对开局的第几天，例如 D12 04:00（D0 是开局那根，开局前显示负数，例如 D-1 23:55；时分是从开局那根算起的经过时间，不是真实钟点）；成交量用相对均量。结束本局揭盲后显示真实时间和价格；标的在界面上一直隐藏，揭盲成功的局在 CSV 里写真实标的，揭盲失败或旧存档写 HIDDEN。</p>
      <DialogFooter>
        <Button variant="primary" onClick={onClose}>知道了</Button>
      </DialogFooter>
    </DialogContent>
  );
}


function ReverseSheet() {
  const t = useTrainer();
  const d = t.dialog;
  const round = t.round;
  const P = round?.pos;
  const open = d?.kind === "reverse";
  let feeEst = "—";
  let sideLabel = "";
  if (open && round && P) {
    const side = opp(P.side);
    const fill = slipPx(round, side, priceNow(round));
    feeEst = uFmt(P.qty * 2 * fill * FEE_TAKER) + " U";
    sideLabel = P.side > 0 ? "多 → 空" : "空 → 多";
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && t.closeDialog()}>
      <DialogContent className="w-[min(400px,calc(100%-32px))]">
        <DialogHeader>
          <DialogTitle>确认反手？</DialogTitle>
        </DialogHeader>
        <DialogDescription className="mt-0 text-[13px] leading-[22px] [&>div>div+div]:mt-2.5" asChild>
            <div>
              <div>将市价平掉当前仓位并开同等大小反向仓（{sideLabel || "反向"}）。</div>
              <div>吃单万 5，带滑点；预估手续费约 <b className="num">{feeEst}</b>（平仓 + 开仓）。</div>
            </div>
          </DialogDescription>
        <DialogFooter>
          <Button variant="secondary" onClick={t.closeDialog}>取消</Button>
          <Button variant="destructive" onClick={t.confirmReverse}>确认反手</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <DialogContent className="w-[min(400px,calc(100%-32px))]">
          <DialogHeader>
            <DialogTitle>结束本局？</DialogTitle>
        </DialogHeader>
        <DialogDescription className="mt-0 text-[13px] leading-[22px] [&>div>div+div]:mt-2.5" asChild>
              <div>
                {t.round?.pos ? (
                  <>
                    <div>
                      当前未实现盈亏{" "}
                      <b
                        className="num"
                        style={{
                          color:
                            uPnl(t.round, priceNow(t.round)) >= 0 ? "var(--up)" : "var(--down)",
                        }}
                      >
                        {sgnU(uPnl(t.round, priceNow(t.round)))} U
                      </b>
                      。
                    </div>
                    <div>持仓会按市价平掉（吃单万 5，带滑点）。</div>
                  </>
                ) : (
                  <div>当前没有持仓。</div>
                )}
                {t.round?.orders.length ? <div>挂单会全部撤销。</div> : null}
              </div>
            </DialogDescription>
          <DialogFooter>
            <Button variant="secondary" onClick={t.closeDialog}>继续交易</Button>
            <Button variant="destructive" onClick={t.confirmEnd}>结束并揭示</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReverseSheet />
      <SpeedSheet />
      <Dialog open={d?.kind === "wipe"} onOpenChange={(o) => !o && t.closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空记录</DialogTitle>
            <DialogDescription>清空全部记录和场次，余额回到 10,000 U。不能恢复。</DialogDescription>
          </DialogHeader>
          <p className="text-[12px] leading-[20px] text-fg-2">
            会同时清掉复盘详情（成交明细、委托事件、持仓统计、画线）和 K 线快照。清之前建议先导出。
          </p>
          <Button variant="secondary" size="sm" className="self-start" onClick={() => void t.exportReview()}>
            先导出复盘详细
          </Button>
          <DialogFooter className="flex-row-reverse justify-start">
            <Button
              variant="destructive"
              onClick={() => {
                const res = t.wipe();
                if (!res.ok) t.toastMsg(res.error, 3000);
              }}
            >
              清空
            </Button>
            <Button variant="secondary" onClick={t.closeDialog}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={d?.kind === "reset"} onOpenChange={(o) => !o && t.closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置余额</DialogTitle>
            <DialogDescription>余额重置为 10,000 U。记录不会删。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row-reverse justify-start">
            <Button
              variant="primary"
              onClick={() => {
                const res = t.resetWallet();
                if (!res.ok) t.toastMsg(res.error, 3200);
              }}
            >
              重置
            </Button>
            <Button variant="secondary" onClick={t.closeDialog}>取消</Button>
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
        <Button variant="secondary" onClick={t.closeDialog}>取消</Button>
        <Button variant="primary" onClick={() => t.setLev(lev)}>确定</Button>
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
          <Button variant="secondary" onClick={t.closeDialog}>取消</Button>
          <Button variant="primary" onClick={() => t.setMode(mode)}>确定</Button>
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
        <Input className="mt-1" value={tp} inputMode="decimal" onChange={(e) => setTp(filterDecimal(e.target.value))} />
        <Label className="mt-3 block">止损触发价</Label>
        <Input className="mt-1" value={sl} inputMode="decimal" onChange={(e) => setSl(filterDecimal(e.target.value))} />
        <p className="hint">按现在的仓位估算：止盈 {est(tpReal)}，止损 {est(slReal)}（已扣平仓手续费，没算滑点）</p>
        <DialogFooter className="flex-row-reverse justify-start">
          <Button
            variant="primary"
            onClick={() => t.applyTpSl(tp.trim() ? parsePrice(tp, base) : null, sl.trim() ? parsePrice(sl, base) : null)}
          >
            确定
          </Button>
          <Button onClick={() => t.applyTpSl(null, null)}>全部清除</Button>
          <Button variant="secondary" onClick={t.closeDialog}>取消</Button>
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
  const [v, setV] = useState(String(+t.speed.toFixed(2)));
  return (
    <DialogContent className="w-[min(400px,calc(100%-32px))]">
        <DialogHeader>
          <DialogTitle>播放速度</DialogTitle>
          <DialogDescription>每根 K 线停多少秒。最快 {SPEED_MIN} 秒，最慢 {SPEED_MAX} 秒，可以填小数。</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Input value={v} autoFocus inputMode="decimal" className="h-8 bg-panel pr-14" onChange={(e) => setV(filterDecimal(e.target.value))} />
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] text-fg-3">秒/根</span>
        </div>
        <DialogFooter className="flex-row-reverse justify-start">
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
          <Button variant="secondary" onClick={t.closeDialog}>取消</Button>
        </DialogFooter>
    </DialogContent>
  );
}
