# Meridian · 美股收盘信号台（SPMO 攒股 + SP500 前 150 增强）

零依赖 Node 脚本（无需 npm install），监控**日线 + 周线**两级信号（同参同逻辑，两套时间框架）：

| 指标 | 规则 | 策略语境 |
|---|---|---|
| RSI6（Wilder，同通达信/TradingView RMA 口径） | `> 70` 超买 / `< 30` 超卖 | 超买 → 做 T 减仓观察；超卖 → 分批吸纳观察 |
| **RSI14（可选周期，新增）** | 同阈值同口径的第二套 RSI | 报告页 RSI6/RSI14 一键切换（表格/周线/chips/KPI/弹层全联动，选择存本机浏览器）；数据与 CSV 两套都给 |
| **回归信号（重点榜单）** | 前一根收盘在超买/超卖区，本根收盘回到 30~70 正常区 | **超买回落** = 做T回补观察；**超卖回升** = 吸纳确认观察 |
| Vegas 三通道 | EMA144/169 短 · EMA288/338 中（=短通道×2）· EMA576/676 长 | 每天记录价格在通道上/内/下的位置，以及当日上下穿事件 |
| **周线（新增）** | 日线按周重采样（周五标签），RSI6/RSI14/三通道/回归信号**同参重算** | 周线超买超卖对应波段高低位；周回归 = 波段反转观察 |

池子：**SP500 实时市值前 150 + SPMO（固定监控）**，候选池快照约 220 只（前 150 监控、余 70 缓冲排名漂移）。每行标注成分归属：**标普500**（池内即成员，池外行单独标）/ **纳指100**（QQQ 成分，蓝色徽标，快照 `data/ndx-candidates.json`）· SPMO 前 40 大持仓标注「SPMO 持仓 %」。

**周线口径说明**：周线 = 日线按周重采样后喂给同一套 RSI6 + Vegas 三通道（阈值/参数与日线完全一致）；周线长通道 EMA576/676 需约 13 年历史，现数据深度（~10 年）下普遍如实标「数据不足」，周短/中通道（约 3/6.5 年）正常可算。

**自选/持仓清单**（`config.json → watchlist.tickers`）：在池子之外加一层"我关心的标的"，写法 `"NVDA"`（无备注）或 `{"ticker":"QQQ","note":"池外ETF"}`（带备注）——

- **池内标的**（如 NVDA）：不重复取数，正常参与排名与全表，行上多一枚「自选」徽标；
- **池外标的**（如 QQQ）：运行时单独取数评估，全表排在末尾（排名位显示★），备注显示在徽标/详情里；
- 报告页顶部有「自选持仓」卡片面板（点卡片看 K 线与口径），筛选 chips 多一枚「自选」；控制台报告、latest.json（`groups.watch` + 行级 `watch/note`）、CSV（自选备注列）同步呈现。

**报告页交互（自选管理）**：

- **搜索框**——按代码/名称（中英文都行）/备注实时过滤全表与移动端卡片；
- **★ 开关**——表格行首、自选卡片、详情弹层都能一键加入/移出自选，改动保存在本机浏览器（localStorage），刷新/重开都记得；config 里的清单不受影响；
- **池外直加**——搜索框输入监控池外的代码（如 `TSM`）会提示「加入自选」，加入后卡片显示腾讯在线报价（名称/现价/涨跌，需联网），完整指标等写进 config 后下次监控纳入；
- **复制清单 → config**——把"config 清单 ＋ 页内增删"合成 JSON 片段复制到剪贴板：公开清单贴进 `config.json`，真实持仓贴进 `config.local.json`（私有层，见下）。

**持仓隐私**：仓库是公开的，真实持仓别写进 `config.json`。把清单放 **`config.local.json`**（已被 .gitignore 排除，不会上传），字段会自动叠加在 `config.json` 之上，本地 `node monitor.mjs` 即可监控你的持仓；公开报告（Actions 云端跑）不含它们。写法见 `config.local.json.example`（复制一份去掉 `.example` 改内容）。

## 快速开始

```bash
node monitor.mjs              # 全量 150+ 只（首次 3~6 分钟，之后走缓存增量，很快）
node monitor.mjs --limit 5    # 只跑前 5 只，试跑
node monitor.mjs --refresh-cache   # 忽略增量判断全量重拉
node test.mjs                 # 离线测试（无网络可跑）
```

输出：

- **控制台报告**——SPMO 主卡、自选持仓、超买榜、超卖榜、回归信号、通道事件、**周线超买/超卖/回归榜**、全表（含周RSI/周通道/成分列）；
- `out/report.html`——自包含网页，双击即看（可传手机），点任意一行看该标的信号解读 + **TradingView 免费嵌入日线 K 线（可切周线）**（本地 lightweight-charts 渲染，零外网请求，离线可用），顶部 chips 按 超买/超卖/回归信号/事件/**周超买/周超卖/周回归**/自选/SPMO重合 筛选，搜索框支持代码/名称/备注；
- `out/latest.json`——结构化结果（给别的工具吃）：行级 `wk{rsi6,tunnels,asOf,bars}`（周线指标）、`sp500`/`ndx`（成分标志）、`watch`/`note`（自选），`groups.weekOverbought/weekOversold/weekReturn`（周线分组）；
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

`config.json`：`universe.topN`（前几名）、`watchlist.tickers`（自选/持仓，写法见上）、`rsi.period/period2/overbought/oversold`（主周期 6，第二周期 14——报告页可切换，想换 7/21 改这里）、`tunnels`（三通道参数，想只看 144/169 就删掉另外两条）、`report`（输出开关）、`notify`。

SP500 候选池：`data/sp500-candidates.json`（快照 + 说明），指数调仓后手工增删；市值排名每次运行时用实时报价重排，不怕次序漂移。

## 测试

`node test.mjs`——148 条断言：EMA/RSI 手算黄金值对账、与 OpenFinLens technical.js 递推逐点互证（随机序列 40 组）、ET 收盘时钟（含夏冬令时边界）、**日线→周线重采样（周五标签/OHLC 聚合）**、第二周期 RSI14（日/周）**、缓存合并、市值排名与成分标注、自选清单归一化/池内外拆分、live bar 剔除、生成物内联脚本语法守卫（含搜索/★增删/周线列/RSI 切换/图表切换逻辑在场）、**PWA manifest/sw.js 语法守卫**。

## 安卓 App

手机不开浏览器、桌面图标直达：**[直接下载 APK](https://5777-wq.github.io/us-stock-monitor/app/us-stock-monitor.apk)**（备用：[GitHub Releases](https://github.com/5777-wq/us-stock-monitor/releases/latest)）。报告页右上角和首页跳转页也有「📱 安卓 App」入口。

- **装**：手机浏览器打开下载链接 → 下载完点开 → 系统提示「未知来源应用」时允许一次即可（自家签名的个人应用，无应用商店）。
- **更新**：App 是 WebView 壳，打开即是线上最新报告——数据每个交易日收盘后自动更新，**无需重装**；壳本身变化（界面/功能）时 `android/` 目录有提交会自动触发 [android-apk workflow](.github/workflows/android-apk.yml) 重构建发布，重装一次 APK 即可。
- **功能**：下拉刷新、断网显示离线页、系统返回键=网页后退、站外链接跳浏览器；App 内点「📱 安卓 App」胶囊经系统下载管理器直接下新壳（通知栏点开即装）；深色模式自动跟随系统（网站深色配色在 App 内同样生效）；自选清单/RSI 周期等本机设置与网页版互通（同一套 localStorage）。启动直达 `out/report.html`，不经过跳转页（避免返回键死循环）。
- 另加 **PWA**：手机 Chrome/Edge 打开网页 → 菜单「添加到主屏幕」，效果接近（免签免装，iOS 也适用）。
- 签名 keystore 与密码随仓库走（`android/signing/`，个人自用无保密需求），保证每次 CI 构建签名一致，可覆盖安装升级。

## 免责声明

仅供个人学习与技术研究。指标只描述事实与常用读法，**不构成投资建议**；数据来自第三方公开接口，有延迟、会出错；据此交易，后果自负。
