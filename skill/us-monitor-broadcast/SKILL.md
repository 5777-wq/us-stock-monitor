---
name: us-monitor-broadcast
description: 读取并播报美股监控最新信号（SPMO + SP500市值前100）：RSI6 超买/超卖、超买回落/超卖回升（回归信号，做T回补与吸纳确认）、Vegas 三通道事件。当用户要求"播报美股监控"、"今天美股有什么信号"、"超买超卖情况"、"美股播报"，或在定时任务里需要汇报监控结果时使用。
---

# 美股监控播报

为用户的自有监控系统（SPMO 攒股 + SP500 前 100 增强）做信号播报。只描述事实与常用读法，**绝不给出买卖建议**。

## 数据在哪（任选其一，优先前者）

1. **线上（任何机器/云端 agent 都能读）**：`https://5777-wq.github.io/us-stock-monitor/out/latest.json` —— 由 GitHub Actions 每个美股交易日 21:30 UTC 自动更新
2. 本机文件：`D:\57的vibe coding内容\global-fin-dashboard\美股监控\out\latest.json`

字段说明：

- `meta.marketDate` 报告对应收盘交易日；`meta.generatedAt` 生成时间
- `spmo`：核心标的 SPMO 行（先读它）
- `rows[]`：100 只，`rsi6{value,state,cross}`、`tunnels[]{key,pos,event}`、`spmoPct`（SPMO 持仓权重）、`adj`（hfq=后复权 / raw=不复权）、`anchored`、`notes[]`（每只的事实解读，可摘引）
- `groups`：`overbought`(超买中) / `oversold`(超卖中) / `obReturn`(超买回落→回归正常区) / `osReturn`(超卖回升→回归正常区) / `events`(通道穿越)，都是 ticker 数组

用户策略语境：攒股 SPMO 为主、围绕它做增强、主要做多；超买时做 T（减仓后回补）；超卖时分批吸纳。**回归信号（前一根收盘在超买/超卖区、本根收盘回到 30~70 正常区）是用户最关心的信号，播报时置顶。**

## 新鲜度检查（播报前必做）

`meta.marketDate` 应等于最近一个已收盘的美股交易日（美东周一~五；北京早上播报对应前夜收盘）。若过期一个交易日以上：

- 云端 agent：直接用线上 JSON 并如实注明数据日期（它由 Actions 自动维护）；
- 本机 agent 可在 `D:\57的vibe coding内容\global-fin-dashboard\美股监控\` 下跑 `node monitor.mjs --quiet`（1~3 分钟）重新生成后再播报。

## 播报模板（简洁优先，别超 15 行）

1. **SPMO**：收盘价、涨跌%、RSI6 数值、三条通道位置（如"三通道全在上方"）
2. **回归信号（置顶，这是重点）**：
   - 超买回落：`groups.obReturn` 的 ticker —— 一句话"前一日超买、今日收盘回到正常区（做T回补观察）"
   - 超卖回升：`groups.osReturn` 同理（"吸纳确认观察"）
3. **当前超买**（`groups.overbought`）：列前 5~8 只，格式 `代码(RSI值)`，SPMO 重仓重合的标注（对照 rows[].spmoPct>0）
4. **当前超卖**（`groups.oversold`）：同上
5. **通道事件**（`groups.events`）：只列 ticker
6. 结尾一句：口径提醒——`adj=raw` 的行不复权（近期拆过股的长通道读数别当真）＋"以上为指标事实描述，不构成投资建议"

无信号的日子就一句话带过（如"今日无超买/超卖，池内 RSI6 全部在正常区"）。

## 边界

- 只读 latest.json / 线上 JSON；如需重跑只跑 `monitor.mjs`，不修改监控代码、不编造数据
- `notes[]` 文字摘引即可，别全文照搬
- 播报通道由用户侧决定（对话、微信、TG 等），本 skill 只负责取数与措辞
