# 复盘详细导出（review export）字段说明

入口：统计面板「复盘详细导出」，或「清空记录」弹窗里的「先导出复盘详细」。一次下载一个 `合约训练复盘.zip`，里面三个文件：

| 文件 | 内容 |
|---|---|
| `review.json` | 主文件：局 → 成交 → 快照；事件、持仓、局内 K 线挂在局下，用 `order_id` / `pos_id` 关联 |
| `review-fills.csv` | 扁平 CSV，一行一笔成交，带对应持仓的 R 字段，不含快照 |
| `review-rounds.csv` | 局级汇总 CSV，一行一局 |

只导出有复盘记录（`fut-review`）的局，即这个功能上线之后打完的局。旧导出（「导出 JSON」「导出 CSV」）不受影响。

代码：`src/lib/export-review.ts`（纯 TS，导出逻辑）、`src/lib/zip.ts`（最小 zip，不压缩）；外壳 `src/state/trainer.tsx` 负责读 IndexedDB 并下载。

## 通用口径

- **字段名**：英文 snake_case。
- **时间 `d_time`**：盲测 D 相对时钟 `D{天} HH:MM`，零点是开局那根（D0 00:00）的**开盘时间**，时分是从零点算起的经过时间，不是真实钟点。所有 `d_time`（成交、事件、快照 K 线、局内 K 线、画线锚点）都取**该 K 线的开盘时间**。注意：市价单是在当前那根收盘后成交的，但 `d_time` 仍写那根的开盘时间；开局前的 K 线是负数天，例如 `D-1 23:55`。
- **价格 `*_100`**：100 制，开局那根（D0）收盘 = 100，`价格 / base × 100`。缺 base 的局（旧存档）所有 100 制价格为 `null`。
- **数量**：**禁止输出真实数量（产品已定）**。只给 `notional_u`（U）和 `qty_100 = notional_u / fill_price_100`（100 制单位量）。`notional_u ÷ qty_100` 只能算回 100 制价，算不回真实价。真实成交量也一律不出，成交量只给 `vol_rel`（相对本局已走过 K 线的均量，与图表一致），揭盲成功的局也不补真实量。
- **揭盲**：只有 `reveal_status = "revealed"`（`revealed === true`）的局才有真实 `symbol`（其余局 `symbol = "HIDDEN"`）、`real_t0`、`real_t1`、成交的 `real{}`、局内 K 线的 `real{}`。其余局（揭盲失败、未揭盲、旧存档）不出现真实标的、日期、绝对价、真实成交量。
  - 已知取舍：揭盲成功局的 `real.fill_price × qty_100 / 100 × base` 可以推出真实数量；这是「揭盲局出真实价」的必然结果，产品已接受。

## bar_index：一套坐标

所有 `bar_index` / `open_bar` / `close_bar` / `mfe_bar` / `mae_bar` 都是**同一套坐标**：base 周期 K 线、从开局那根算起，**0 = D0（开局那根）**，1 = 下一根…（与旧导出 `list[].i` 相同）。

- `fill.bar_index`：成交发生在哪一根（市价单 = 下单时最后一根已收盘 K 线；限价 / 止盈止损 / 强平 = 触发的那一根）。
- `snapshot.bar_index`：拍快照那一刻最后一根已收盘的 base K 线，即**下单时**所在的那根。
  - 市价单：与 `fill.bar_index` 相同。
  - 限价单：快照在**挂单时**拍，成交在之后的某根，所以 `snapshot.bar_index ≤ fill.bar_index`，差值就是挂单等待的根数。
- `event.bar_index`：事件发生的那根；`round_bars[].bar_index`：0 … `total_bars`。

## 局（rounds[]）

| 字段 | 说明 |
|---|---|
| `round_id` | 开局时刻（毫秒时间戳，是**游玩**时间，不是行情时间），与旧导出 `startedAt` 相同 |
| `reveal_status` | `revealed` / `blind` |
| `symbol` | 揭盲成功为真实标的；其余局为字符串 `"HIDDEN"`（与两个 CSV 一致） |
| `real_t0`、`real_t1` | 仅揭盲成功；北京时间 `YYYY-MM-DD HH:MM` |
| `d0`、`t1` | 固定 `D0 00:00`；局终那根的 D 时间 |
| `base_interval`、`intervals` | 本局 base 周期；本局可用的全部周期 |
| `aggregated_timeframes` | 由 base 聚合补上的周期（新币开局前无历史 / 拉取失败），`[]` = 无；`null` = 记录早于该字段 |
| `total_bars` | 开局后走过的根数 |
| `end_reason`、`pnl`、`fees`、`start_equity`、`end_equity`、`max_drawdown`、`fills_cut` | 同局级日志；`fills_cut` = 超过 500 笔被截掉的成交数 |
| `snapshots_status`、`snapshots_reason` | `ok` / `partial` / `missing`；缺失原因（超出最近 50 局 / 未找到） |
| `round_bars`、`round_bars_reason` | base K 线 D0 → 局终（100 制 o/h/l/c + `vol_rel`，揭盲局另有 `real{o,h,l,c}`）；与快照一样存在 IndexedDB，只保留最近 50 局，缺失为 `null` + 原因 |
| `fills[]`、`events[]`、`positions[]`、`end_drawings[]` | 见下 |

## 成交（fills[]）

`order_id`（市价、止盈止损、强平、局终也有单号）、`bar_index`、`d_time`、`view_interval`（下单时所看的视图周期，自动成交为 null）、`side`（long/short）、`open_close`（open/add/close/reverse）、`order_type`（market / limit / limit_taker / tp / sl / liq）、`order_price_100`（限价、触发价；市价 null）、`fill_price_100`（含滑点）、`notional_u`、`qty_100`、`leverage`、`tp_100`/`sl_100`（开仓类成交 = 成交后生效的；平仓类 = 平仓前的）、`fee`、`realized_pnl`、`close_reason`（tp / sl / manual / round_end / liq，仅平仓类）、`pos_id`、`open_pos_id`（反手新开的那笔）、`snapshot`、`snapshot_reason`。

**快照**（`snapshot`）：下单那一刻拍。`frames[]` 四档 5m×200、15m×100、1h×100、4h×60，只取已收盘 K 线（每根 `d_time` + 100 制 o/h/l/c + `vol_rel`），拿不到写 `got` 与 `reason`（例如 base 比 5m 长、由 base 聚合、已收盘只有 N 根）；`indicators[]`（kind + params）；`drawings[]`（画线：类型、锚点 `d_time` + `price_100`）。自动成交（止盈 / 止损 / 强平 / 局终）没有下单快照，`snapshot = null` 并写原因。

## 委托事件（events[]）

`kind`：`place`（挂单）/ `cancel`（撤单，含保证金不足自动撤、强平后撤、局终撤）/ `trigger`（成交触发）/ `tpsl`（止盈止损设置或修改）。没有改价事件（产品未做改价）。字段：`bar_index`、`d_time`、`order_id`、`price_100`、`tp_100`、`sl_100`、`qty_100`、`notional_u`（只有 `trigger` 有值，等于同单号那笔成交；其余为 null）、`side`、`src`（market/limit/tp/sl/liq/round_end/manual/order）、`why`、`pos_id`。

## 持仓（positions[]）与 R

一笔持仓从开仓到平掉；**反手 = 旧的一笔平掉 + 新开一笔**，新的一笔重新算 R。

| 字段 | 说明 |
|---|---|
| `entry_100` | **首笔**开仓价 |
| `initial_sl_100` | 首笔开仓单上带的止损；没带止损 → 所有 R 字段为 `null`（之后补设止损也不算） |
| `initial_risk_100` | `|entry − initial_sl|`，**100 制价差**，不是 R 倍数 |
| `risk_u` | **R 的分母**：`initial_risk × 首笔数量`（U）。**加仓不增加 R 的分母**，改止损也不改它 |
| `risk_u_max` | 开仓与每次加仓后，按当时均价、当时止损、当时总数量算的风险（U）取最大值；仅供参考，不作分母 |
| `mfe_100` / `mae_100` | 持仓期间最有利 / 最不利价格 |
| `mfe_r` / `mae_r` | 与首笔开仓价的距离 ÷ `initial_risk`，都是 ≥ 0 的距离 |
| `mfe_bar` / `mae_bar` | 达到 MFE / MAE 的那根；没有有利 / 不利波动时为 `null`（此时 `mfe_100` / `mae_100` = 开仓价，R = 0） |
| `realized_pnl`、`fees` | 这笔持仓所有平仓的已实现盈亏（不含手续费）；这笔持仓所有成交的手续费（反手那笔按数量拆分） |
| `r_multiple` / `r_multiple_net` | `realized_pnl / risk_u`；扣手续费后 `(realized_pnl − fees) / risk_u` |
| `bars_held`、`adds`、`close_reason` | 持仓根数（close_bar − open_bar）、加仓次数、平仓原因 |

**MFE / MAE 口径（统一）**：

- 只用 **K 线高低点**：持仓期间每根 base K 线的 high / low。**成交价不参与**（市价成交价含滑点，可能落在 K 线范围之外）。
- **开仓那根 K 线不算**：市价开仓发生在那根收盘之后；限价在那根中途成交时，成交前后的走势无法区分，一律不算。
- **平仓那根**：市价手动平仓 / 局终平仓发生在那根收盘后，那根整根已计入；在 K 线中途触发的止盈 / 止损 / 强平 / 限价平仓，那根只计到**触发价**为止。
- **限价单在 K 线中途成交的已知局限**：模拟只按「开 → 低/高 → 高/低 → 收」的路径处理一根 K 线，限价单在中途成交后，**同一根 K 线的后半段**不会再计入 MFE / MAE（开仓那根本来就不算；平仓那根只算到成交价）。

## 局内 K 线（round_bars[]）

base 周期，D0 → 局终，`bar_index` 0 … `total_bars`，字段 `d_time`、`o/h/l/c`（100 制）、`vol_rel`，揭盲局另有 `real{o,h,l,c}`（不含真实量）。局终时写入 IndexedDB（与下单快照同一条记录），只保留最近 50 局；超出或早于此功能的局为 `null` 并写 `round_bars_reason`。

## 局级汇总 CSV（review-rounds.csv）

`round_id, reveal_status, symbol(未揭盲为 HIDDEN), base_interval, aggregated_timeframes, total_bars, end_reason, fills, fills_cut, pnl, fees, start_equity, end_equity, max_drawdown, positions, positions_with_r, r_sum, r_avg, r_net_sum, r_net_avg, r_best, r_worst, r_wins, r_losses`。R 汇总只统计有首笔止损（R 非 null）的持仓。

`aggregated_timeframes` 填法：有聚合 → 周期用 `|` 连接（如 `15m|1h`）；没有聚合（`[]`）→ 留空；老局（JSON 里为 `null`）→ `NA`。

## 成交 CSV（review-fills.csv）

成交主要字段 + 对应持仓 `pos_side, pos_bars_held, pos_entry_100, pos_initial_risk_100, pos_risk_u, pos_risk_u_max, pos_mfe_r, pos_mae_r, pos_mfe_bar, pos_mae_bar, pos_r_multiple, pos_r_multiple_net` + `has_snapshot`。不含快照和 `real{}`。

## 存储与保留

- 复盘详情（成交、事件、持仓、局终画线、聚合周期）：localStorage `fut-review`，跟局日志一样保留 600 局。
- 下单快照 + 局内 K 线：IndexedDB `ktrainer-review` / `snaps`，只保留最近 50 局，超出先删最旧的；成交和事件不受影响。
- 「清空记录」同时清掉以上两处。
