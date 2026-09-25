# 美股监控 · SPMO 攒股 + SP500 前 100 增强

零依赖 Node 脚本（无需 npm install），监控**日线收盘**两级信号：

| 指标 | 规则 | 策略语境 |
|---|---|---|
| RSI6（Wilder，同通达信/TradingView RMA 口径） | `> 70` 超买 / `< 30` 超卖 | 超买 → 做 T 减仓观察；超卖 → 分批吸纳观察 |
| **回归信号（重点榜单）** | 前一根收盘在超买/超卖区，本根收盘回到 30~70 正常区 | **超买回落** = 做T回补观察；**超卖回升** = 吸纳确认观察 |
| Vegas 三通道 | EMA12/36 短 · EMA144/169 主（Vegas Tunnel 本体）· EMA576/676 长 | 每天记录价格在通道上/内/下的位置，以及当日上下穿事件 |

池子：**SP500 实时市值前 100 + SPMO（固定监控）**。成分快照约 130 只候选，运行时用腾讯实时总市值重排取前 100；命中华夏 SPMO 前 40 大持仓的标的会标注「SPMO 持仓 %」。

## 快速开始

```bash
node monitor.mjs              # 全量 101 只（首次 2~4 分钟，之后走缓存增量，很快）
node monitor.mjs --limit 5    # 只跑前 5 只，试跑
node monitor.mjs --refresh-cache   # 忽略增量判断全量重拉
node test.mjs                 # 离线测试（无网络可跑）
```

输出：

- **控制台报告**——SPMO 主卡、超买榜、超卖榜、今日事件、全表；
- `out/report.html`——自包含网页，双击即看（可传手机），点任意一行看该标的元信息与指标解读，顶部 chips 按 超买/超卖/事件/SPMO重合 筛选；
- `out/latest.json`——结构化结果（给别的工具吃）；
- `out/report-<日期>.csv`——Excel 直开（UTF-8 BOM）；
- `out/cache/`——K 线缓存（按日期去重合并，日常只增量拉 120 根）。

## 数据口径（重要）

- **复权降级链：东财 push2his 后复权（fqt=2）→ Yahoo 复权收盘 → 腾讯不复权兜底**。东财：乘性口径含拆股+分红，约 2400+ 根；Node fetch 被其 WAF 拒时退 curl 子进程，熔断 60s 后自动冷却重试。Yahoo：拆股+分红双复权的收盘价（10 年），指标只用收盘价所以够用，东财不可达时自动顶上。腾讯：美股是不复权原始价，仅最后兜底，行上会打「不复权」徽标（近一年内有拆股的标的，其长通道 EMA576/676 不可信，RSI6/主通道不受影响）。
- **后复权序列展示时用报价现价等比锚定回"现价口径"**（等价于锚定今日的前复权）：收盘价列永远显示真实价位，RSI/EMA/通道因尺度不变而完全不受影响。
- **本机东财被 WAF 封时的彻底解法**：部署上层 openfinlens 现成的 Cloudflare Worker（`worker.js`，只允许代理行情域名，安全），然后把 worker 地址填进 `config.json → sources.eastProxy`（如 `https://你的名字.workers.dev`），本机的东财请求就经 Cloudflare IP 出去了，绕开本机 IP 封禁。
- RSI6 用 Wilder 平滑（与通达信 SMA(X,N,1)、TradingView RMA 同口径）；EMA 种子 = 前 n 项 SMA。与上层 OpenFinLens 看板 js/technical.js 完全同口径。
- 盘中运行安全：只认已收盘 bar（按 ET 墙钟判定），未收盘的 live bar 单独标注「盘中参考」，不进信号。
- 次新标的（如 GEV 2024-04 分拆）：长窗口 EMA 数据不足时如实标「暂缺」，不算异常。

## 每天自动跑

### 方案 A：本地 Windows 计划任务

```bat
:: 注册（每天北京时间 4:30，美股已收盘；夏令时 4:30、冬令时 5:30 后都安全）
schtasks /Create /TN "US-Monitor" /TR "\"D:\57的vibe coding内容\global-fin-dashboard\美股监控\run-daily.bat\"" /SC DAILY /ST 04:30
:: 删除：schtasks /Delete /TN "US-Monitor" /F
```

`run-daily.bat` 会把控制台输出追加到 `out\run.log`。

### 方案 B：GitHub Actions（本仓库已内置 `.github/workflows/us-monitor.yml`）

- 每周一~五 21:30 UTC（美东收盘后）自动跑，并把 `out/`（报告 + 缓存）提交回仓库；
- `out/cache/` 一起提交：Actions 下次跑只增量拉 120 根，不再全量 bootstrap，也减少触发东财 WAF 的机会；
- 手动触发：仓库 → Actions → us-monitor → Run workflow。

### 手机上看

私有仓库里直接打开 `out/report.html` → 文件视图右上角 Preview 渲染；或把仓库转 public 后开 GitHub Pages（Settings → Pages）绑自己的域名，就是一条网址。推送通知见下。

## 手机上看（已上线）

**线上地址：<https://5777-wq.github.io/us-stock-monitor/>**（仓库公开 + GitHub Pages，Actions 每个美股交易日收盘后自动更新报告）。仓库当前为 public——免费 `github.io` 域名只给公开仓库；若改回 private，Pages 会停（私有仓库用 Pages 需 GitHub Pro）。也可本地 `out/report.html` 双击看。

## 推送通知（可选，默认关）

`config.json` → `notify`，三选多：

```json
"notify": {
  "enabled": true,
  "onlySignals": true,
  "serverchanSendkey": "SCT…",     // Server酱，微信接收
  "barkUrl": "https://api.day.app/你的key",
  "telegramToken": "123:abc", "telegramChatId": "你的chatId"
}
```

只推有信号的日子（`onlySignals`），内容：SPMO 收盘 + 回归信号（超买回落/超卖回升）+ 超买/超卖榜 + 通道事件。

## 让 AI 替你播报

已装好个人 skill `us-monitor-broadcast`（`C:\Users\WangQ\.agents\skills\`）：任何 agent 读到"播报美股监控/今天美股信号"就会读 `out/latest.json` 按固定模板播报（回归信号置顶），数据过期会自动重跑监控。配合定时任务（如每天早上触发一次对话）即可实现自动播报。

## 配置

`config.json`：`universe.topN`（前几名）、`rsi.period/overbought/oversold`、`tunnels`（三通道参数，想只看 144/169 就删掉另外两条）、`report`（输出开关）、`notify`。

SP500 候选池：`data/sp500-candidates.json`（快照 + 说明），指数调仓后手工增删；市值排名每次运行时用实时报价重排，不怕次序漂移。

## 测试

`node test.mjs`——56 条断言：EMA/RSI 手算黄金值对账、与 OpenFinLens technical.js 递推逐点互证（随机序列 40 组）、ET 收盘时钟（含夏冬令时边界）、缓存合并、市值排名、live bar 剔除、生成物内联脚本语法守卫。

## 免责声明

仅供个人学习与技术研究。指标只描述事实与常用读法，**不构成投资建议**；数据来自第三方公开接口，有延迟、会出错；据此交易，后果自负。
