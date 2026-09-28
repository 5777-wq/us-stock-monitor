#!/usr/bin/env node
/* monitor.mjs —— 美股监控 CLI（零依赖，Node 20+）
 *
 * 监控策略（用户自述）：
 *   · 池子：SP500 实时市值前 100 + SPMO（核心攒股标的，固定监控）；
 *   · 指标：日线收盘 RSI6（Wilder）>70 超买（做T观察）/<30 超卖（吸纳观察）；
 *   · Vegas 三通道：EMA144/169 短 · EMA288/338 中 · EMA576/676 长，
 *     记录价格相对通道位置与当日上下穿事件。
 * 用法：
 *   node monitor.mjs                     # 全量 101 只（首次约 2-4 分钟，之后增量很快）
 *   node monitor.mjs --limit 5           # 只取前 5 只（试跑）
 *   node monitor.mjs --config my.json    # 自定义配置
 *   node monitor.mjs --refresh-cache     # 忽略增量判断，全量重拉
 * 盘中运行安全：marketDate 只认已收盘交易日，未收盘 bar 只作 live 参考，不进信号。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSeries, eastStatus, yahooStatus, tencentQuotes, anchorSeries } from './lib/sources.mjs';
import { buildUniverse, tvSymbolOf, normalizeWatchlist, splitWatchlist, watchTargetOf } from './lib/universe.mjs';
import { emaSeries } from './lib/indicators.mjs';
import { evaluate, summarize } from './lib/signals.mjs';
import { lastClosedDate, etNow } from './lib/market.mjs';
import { consoleReport, writeOutputs } from './lib/report.mjs';
import { notifyIfEnabled } from './lib/notify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 参数与配置 ---------- */

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--limit') a.limit = Number(argv[++i]) || 0;
    else if (t === '--config') a.config = argv[++i];
    else if (t === '--refresh-cache') a.refresh = true;
    else if (t === '--quiet') a.quiet = true;
    else if (t === '--no-html') a.noHtml = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else a._.push(t);
  }
  return a;
}

function loadConfig(file) {
  const p = path.resolve(HERE, file || 'config.json');
  const defaults = {
    universe: { topN: 100, candidatesFile: 'data/sp500-candidates.json', quoteBatch: 60 },
    rsi: { period: 6, overbought: 70, oversold: 30 },
    tunnels: [
      { key: '短通道', n: [144, 169] },
      { key: '中通道', n: [288, 338] },
      { key: '主通道', n: [144, 169] },
      { key: '长通道', n: [576, 676] },
    ],
    sources: { bootstrapLmt: 2000, refreshLmt: 120 },
    watchlist: { tickers: [] },
    report: { outDir: 'out', console: true, json: true, csv: true, html: true },
    notify: { enabled: false, onlySignals: true, serverchanSendkey: '', barkUrl: '', telegramToken: '', telegramChatId: '' },
  };
  if (!existsSync(p)) return defaults;
  const user = JSON.parse(readFileSync(p, 'utf8'));
  const merge = (d, u) => {
    if (!u) return d;
    const o = Array.isArray(d) ? [...d] : { ...d };
    for (const k of Object.keys(u)) o[k] = u[k] && typeof u[k] === 'object' && !Array.isArray(u[k]) ? merge(d[k] || {}, u[k]) : u[k];
    return o;
  };
  let merged = merge(defaults, user);
  /* config.local.json（gitignore，持仓隐私）叠加在 config.json 之上；
   * --config 显式指定时不叠加（明确要看的就只是那份配置）。坏文件静默忽略。 */
  if (!file) {
    const lp = path.join(HERE, 'config.local.json');
    if (existsSync(lp)) {
      try { merged = merge(merged, JSON.parse(readFileSync(lp, 'utf8'))); }
      catch { /* 隐私配置层解析失败不弄挂监控 */ }
    }
  }
  return merged;
}

/* ---------- 主流程 ---------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node monitor.mjs [--limit N] [--config file] [--refresh-cache] [--quiet] [--no-html]');
    process.exit(0);
  }
  const cfg = loadConfig(args.config);
  const outDir = path.resolve(HERE, cfg.report.outDir || 'out');
  const cacheDir = path.join(outDir, 'cache');
  const quiet = args.quiet;

  const et = etNow();
  const marketDate = lastClosedDate();
  if (!quiet) console.error(`[${et.date} ${et.hhmm} ET] 最后已收盘交易日: ${marketDate}`);

  /* 1. 池子：SP500 候选 → 实时市值前 N */
  const { universe, candidatesMeta, spmoHoldings, spmoQuote } = await buildUniverse({
    topN: cfg.universe.topN,
    candidatesFile: cfg.universe.candidatesFile,
    quoteBatch: cfg.universe.quoteBatch,
  });
  const picked = args.limit ? universe.slice(0, args.limit) : universe;
  if (!quiet) console.error(`候选池 ${candidatesMeta.asOf} 共 ${universe.length}+1 只（含SPMO）；报价命中 ${universe.filter((r) => !r.mcapMissing).length}/${universe.length}`);

  /* 2. 逐标的取数 + 评估（SPMO 排第一） */
  const targets = [
    {
      ticker: 'SPMO', rank: null, mcapUsd: null, spmoPct: null,
      name: (spmoQuote && spmoQuote.name) || '标普500动量ETF-Invesco',
      quotePrice: spmoQuote ? spmoQuote.price : null,
      tvSymbol: tvSymbolOf(spmoQuote && spmoQuote.code, 'SPMO'),
    },
    ...picked,
  ];

  /* 1.5 自选/持仓：池内标的就地打标（不重复取数），池外标的补报价后新增目标 */
  const watchlist = normalizeWatchlist(cfg.watchlist);
  const { extra: extraWatch } = splitWatchlist(targets, watchlist);
  if (extraWatch.length) {
    const wQuotes = await tencentQuotes(extraWatch.map((w) => w.ticker), { batch: cfg.universe.quoteBatch || 60 });
    targets.push(...extraWatch.map((w) => watchTargetOf(
      w,
      wQuotes.find((q) => String(q.query || '').replace(/^us/i, '').toUpperCase() === w.ticker),
    )));
  }
  if (watchlist.length && !quiet) console.error(`自选/持仓 ${watchlist.length} 只（池内打标 ${watchlist.length - extraWatch.length} · 池外新增 ${extraWatch.length}）`);
  const rows = [];
  const failed = [];
  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    if (!quiet) console.error(`[${i + 1}/${targets.length}] ${m.ticker} …`);
    let series = null;
    try {
      series = await getSeries(m.ticker, {
        cacheDir,
        bootstrapLmt: cfg.sources.bootstrapLmt,
        refreshLmt: args.refresh ? cfg.sources.bootstrapLmt : cfg.sources.refreshLmt,
        eastProxy: cfg.sources.eastProxy || undefined,
      });
    } catch (e) { if (!quiet) console.error(`  ✗ ${e.message}`); }
    if (!series || series.bars.length < 30) { failed.push({ ...m, reason: series ? 'bars<30' : '取数失败' }); continue; }
    // 后复权序列锚定回现价口径（RSI/EMA 尺度不变，仅展示价回归真实价位）
    const anchored = anchorSeries(series, m.quotePrice);
    if (anchored !== series) series = anchored;
    const row = evaluate(m, series, cfg, marketDate);
    if (!row) { failed.push({ ...m, reason: '指标计算数据不足' }); continue; }
    row.anchored = series.anchored || false;
    row.tvSymbol = m.tvSymbol || m.ticker;
    if (m.watch) { row.watch = true; row.note = m.watchNote || ''; }
    // 报表 K 线用：最近 90 根已收盘 bar + 六条 EMA（服务端对全量历史算好再切片，
    // 长通道 EMA576/676 不可能从 90 根窗口现场算）——只进 HTML，不进 latest.json
    const closedBars = series.bars.filter((b) => b[0] <= marketDate);
    const win = closedBars.slice(-90);
    const allCloses = closedBars.map((b) => b[2]);
    const startI = allCloses.length - win.length;
    const emaSlice = (n) => {
      const seq = emaSeries(allCloses, n);
      return win.map((_, i) => {
        const v = seq[startI + i];
        return v === null ? null : +v.toFixed(3);
      });
    };
    row.k = {
      d: win.map((b) => b[0]),
      o: win.map((b) => +b[1].toFixed(3)),
      h: win.map((b) => +b[3].toFixed(3)),
      l: win.map((b) => +b[4].toFixed(3)),
      c: win.map((b) => +b[2].toFixed(3)),
      e: [144, 169, 288, 338, 576, 676].map(emaSlice),
    };
    rows.push(row);
    await sleep(60);
  }

  const spmo = rows.find((r) => r.ticker === 'SPMO') || null;
  const stockRows = rows.filter((r) => r.ticker !== 'SPMO');
  const summary = summarize([spmo, ...stockRows].filter(Boolean));
  const es = eastStatus();

  const meta = {
    marketDate,
    generatedAt: new Date().toISOString(),
    generatedAtLocal: new Date().toLocaleString('zh-CN', { hour12: false }),
    runAtEt: `${et.date} ${et.hhmm} ET`,
    topN: cfg.universe.topN,
    extraNote: ' + SPMO',
    candidatesAsOf: candidatesMeta.asOf,
    universeNote: `SPMO持仓快照 ${spmoHoldings.asOf || '不可用'}（前40大，标记重合）`,
    srcEast: rows.filter((r) => r.source === 'eastmoney').length,
    srcYahoo: rows.filter((r) => r.source === 'yahoo').length,
    srcTx: rows.filter((r) => r.source === 'tencent').length,
    srcFail: failed.length,
    eastError: es.disabled ? (es.lastError || '熔断') : null,
    yahooError: (() => { const ys = yahooStatus(); return ys.fails && ys.lastError ? ys.lastError : null; })(),
    liveCount: rows.filter((r) => r.live).length,
    watchCount: rows.filter((r) => r.watch).length,
  };

  const data = { meta, cfg, spmo, rows: stockRows, summary, failed, outputs: [] };
  // --limit 是试跑：写 out/preview，绝不覆盖正式报告（曾发生试跑快照顶掉全量报告）
  const outputs = writeOutputs(data, args.limit ? path.join(outDir, 'preview') : outDir, { csv: cfg.report.csv, html: cfg.report.html && !args.noHtml });
  data.outputs = outputs.map((p) => path.relative(HERE, p));

  if (cfg.report.console !== false) console.log(consoleReport(data));

  await notifyIfEnabled(cfg.notify, data);

  if (!rows.length) {
    console.error('✗ 全部取数失败 —— 检查网络后重试，或删掉 out/cache 后重跑');
    process.exit(2);
  }
}

main().catch((e) => { console.error('✗ 运行失败:', e && e.stack || e); process.exit(1); });
