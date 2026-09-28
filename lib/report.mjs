/* report.mjs —— 输出层：控制台表格 / latest.json / CSV / 自包含 HTML
 * HTML 零依赖自包含：数据内联 window.__REPORT__，页内复制一份指标计算
 * （与 lib/indicators.mjs 同口径），图表用内联 SVG，可离线双击打开、
 * 也可提交进仓库用 GitHub Pages 在手机上看。 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---------- 文本对齐（CJK 记 2 列） ---------- */
const w = (s) => String(s ?? '').split('').reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e00 ? 2 : 1), 0);
function pad(s, n, right = false) {
  s = String(s ?? '');
  const gap = n - w(s);
  if (gap <= 0) return s;
  return right ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}
const fmtNum = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '--');
const fmtPct = (v, d = 2, sign = true) => (Number.isFinite(v) ? (sign && v > 0 ? '+' : '') + v.toFixed(d) + '%' : '--');
const fmtMcap = (v) => (Number.isFinite(v) ? (v / 1e8).toFixed(0) + '亿' : '--');
const POS_TXT = { above: '上', inside: '内', below: '下' };
const RSI_TXT = { overbought: '超买', oversold: '超卖', neutral: '' };

/* 按显示宽度截断（CJK 记 2），超宽补省略号 */
function clip(s, n) {
  let out = '', wsum = 0;
  for (const ch of String(s ?? '')) {
    const cw = ch.charCodeAt(0) > 0x2e00 ? 2 : 1;
    if (wsum + cw > n - 1) { out += '…'; break; }
    out += ch; wsum += cw;
  }
  return out;
}

function rowLine(r) {
  const t = r.tunnels || [];
  const tun = (i) => (t[i] && t[i].pos ? POS_TXT[t[i].pos] + (t[i].event && t[i].event.startsWith('break') ? '!' : '') : '·');
  const ev = [];
  if (r.rsi6 && r.rsi6.cross === 'into_ob') ev.push('新进超买');
  if (r.rsi6 && r.rsi6.cross === 'into_os') ev.push('新进超卖');
  if (r.rsi6 && r.rsi6.cross === 'out_ob') ev.push('超买回落');
  if (r.rsi6 && r.rsi6.cross === 'out_os') ev.push('超卖回升');
  for (const x of t) if (x.event && x.event.startsWith('break')) ev.push((x.event === 'break_up' ? '上穿' : '下穿') + x.key);
  return [
    pad(r.rank ?? '★', 4, true),
    pad(r.ticker, 7),
    pad(clip(r.name, 18), 19),
    pad(fmtNum(r.close), 9, true),
    pad(fmtPct(r.chgPct), 7, true),
    pad(r.rsi6 ? fmtNum(r.rsi6.value, 1) : '--', 6, true),
    pad(r.rsi6 ? RSI_TXT[r.rsi6.state] : '--', 4),
    pad(tun(0), 3, true), pad(tun(1), 3, true), pad(tun(2), 3, true),
    pad(r.spmoPct !== null && r.spmoPct !== undefined ? fmtNum(r.spmoPct, 1) + '%' : '', 6, true),
    pad((r.adj === 'raw' ? '[不复权] ' : '') + ev.join(','), 26),
  ].join(' ');
}

const HEAD = ['排名', '代码', '名称', '收盘', '涨跌', 'RSI6', '状态', '短', '主', '长', 'SPMO%', '事件'];
const COLW = [4, 7, 19, 9, 7, 6, 4, 3, 3, 3, 6, 26];

/* ---------- 控制台 ---------- */
export function consoleReport(data) {
  const L = [];
  const { meta, spmo, rows, summary } = data;
  L.push('═'.repeat(96));
  L.push(`美股监控 · ${meta.marketDate} 收盘${meta.liveCount ? `（盘中另见 live 参考，共 ${meta.liveCount} 只含未收盘 bar）` : ''} · 生成于 ${meta.generatedAtLocal}`);
  L.push(`池子：SP500 实时市值前 ${meta.topN}${meta.extraNote || ' + SPMO'} · 候选池快照 ${meta.candidatesAsOf} · ${meta.universeNote || ''}`);
  L.push(`数据：东财后复权 ${meta.srcEast} 只${meta.srcYahoo !== undefined ? ` · Yahoo 复权 ${meta.srcYahoo} 只` : ''} · 腾讯不复权兜底 ${meta.srcTx} 只 · 失败 ${meta.srcFail} 只${meta.eastError ? ` · 东财: ${meta.eastError}` : ''}${meta.yahooError ? ` · Yahoo: ${meta.yahooError}` : ''}`);
  L.push('═'.repeat(96));

  if (spmo) {
    L.push('');
    L.push('◆ 核心标的 SPMO（标普500动量ETF）');
    L.push('  ' + rowLine(spmo));
    for (const n of spmo.notes || []) L.push(`    · [${n.tag}] ${n.text}`);
    if (spmo.live) L.push(`    · 盘中参考：现价 ${fmtNum(spmo.live.close)} · RSI6 ${fmtNum(spmo.live.rsi6, 1)}`);
  }

  const section = (title, arr, hint) => {
    if (!arr.length) return;
    L.push('');
    L.push(`◆ ${title}（${arr.length}）${hint ? '—— ' + hint : ''}`);
    for (const r of arr) L.push('  ' + rowLine(r));
  };
  section('超买 RSI6 > ' + data.cfg.rsi.overbought, summary.overbought, '策略语境：超买观察做T');
  section('超卖 RSI6 < ' + data.cfg.rsi.oversold, summary.oversold, '策略语境：超卖观察分批吸纳');
  section('超买回落 RSI6 回到正常区', summary.obReturn, '前一根超买 → 本根收盘回落（做T回补观察）');
  section('超卖回升 RSI6 回到正常区', summary.osReturn, '前一根超卖 → 本根收盘回升（吸纳确认观察）');
  section('通道事件', summary.events, 'Vegas 通道上下穿/回入');

  L.push('');
  L.push('◆ 全表（按市值排名）');
  L.push('  ' + COLW.map((n, i) => pad(HEAD[i], n)).join(' ').trimEnd());
  for (const r of rows) L.push('  ' + rowLine(r));

  const fails = data.failed || [];
  if (fails.length) {
    L.push('');
    L.push(`◆ 取数失败（${fails.length}）：` + fails.map((f) => f.ticker).join(' '));
  }
  L.push('');
  L.push('输出：' + data.outputs.join(' · '));
  L.push('口径：RSI6=Wilder 平滑（同通达信/TradingView RMA）；EMA 种子=前 n 项 SMA；三通道=EMA12/36·144/169·576/676（Vegas Tunnel）。');
  L.push('声明：指标只描述事实与常用读法，不构成投资建议。');
  return L.join('\n');
}

/* ---------- JSON ---------- */
function jsonPayload(data) {
  const { meta, spmo, rows, summary, cfg } = data;
  const slim = (r) => r && ({
    ticker: r.ticker, name: r.name, rank: r.rank, mcapUsd: r.mcapUsd, spmoPct: r.spmoPct,
    asOf: r.asOf, close: r.close, chgPct: r.chgPct,
    rsi6: r.rsi6, tunnels: r.tunnels, live: r.live, adj: r.adj, anchored: r.anchored || false, tvSymbol: r.tvSymbol || r.ticker, source: r.source, bars: r.bars, notes: r.notes,
  });
  return {
    version: 1,
    strategy: 'SPMO 攒股 + SP500前100 增强 · 日线 RSI6 超买超卖 + Vegas 三通道',
    meta,
    cfg: { rsi: cfg.rsi, tunnels: cfg.tunnels.map((t) => ({ key: t.key, n: t.n })) },
    spmo: slim(spmo),
    rows: rows.map(slim),
    failed: data.failed,
    groups: {
      overbought: summary.overbought.map((r) => r.ticker),
      oversold: summary.oversold.map((r) => r.ticker),
      obReturn: summary.obReturn.map((r) => r.ticker),
      osReturn: summary.osReturn.map((r) => r.ticker),
      events: summary.events.map((r) => r.ticker),
    },
  };
}

/* ---------- CSV（UTF-8 BOM，Excel 直开） ---------- */
function csvPayload(data) {
  const cell = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ['排名', '代码', '名称', '市值亿USD', '收盘', '涨跌%', 'RSI6', 'RSI前值', 'RSI状态', 'RSI穿越', '短通道', '主通道', '长通道', '通道事件', 'SPMO持仓%', '数据源', '复权', '截至'];
  const pos = (t) => (t && t.pos ? { above: '上', inside: '内', below: '下' }[t.pos] : '');
  const ev = (r) => {
    const a = [];
    if (r.rsi6?.cross === 'into_ob') a.push('新进超买');
    if (r.rsi6?.cross === 'into_os') a.push('新进超卖');
    if (r.rsi6?.cross === 'out_ob') a.push('超买回落');
    if (r.rsi6?.cross === 'out_os') a.push('超卖回升');
    for (const t of r.tunnels || []) if (t.event) a.push(t.key + ':' + t.event);
    return a.join('|');
  };
  const line = (r) => [r.rank ?? 'SPMO', r.ticker, r.name, r.mcapUsd ? (r.mcapUsd / 1e8).toFixed(0) : '', r.close, r.chgPct?.toFixed(2) ?? '', r.rsi6?.value?.toFixed(2) ?? '', r.rsi6?.prev?.toFixed(2) ?? '', RSI_TXT[r.rsi6?.state] ?? '', r.rsi6?.cross ?? '', pos(r.tunnels?.[0]), pos(r.tunnels?.[1]), pos(r.tunnels?.[2]), ev(r), r.spmoPct ?? '', r.source, r.adj, r.asOf].map(cell).join(',');
  return '\uFEFF' + [head.join(','), ...[data.spmo, ...data.rows].filter(Boolean).map(line)].join('\r\n') + '\r\n';
}

/* ---------- HTML（自包含） ---------- */
export function htmlPayload(data) {
  const { meta, cfg, summary } = data;
  // rows 已是不含 SPMO 的股票行；SPMO 单独内联，页面端拼 [D.spmo, ...D.rows]（别重复拼）
  const pageRows = data.rows.filter(Boolean);
  const json = JSON.stringify({ meta, cfg, spmo: data.spmo, rows: pageRows, groups: { overbought: summary.overbought.map((r) => r.ticker), oversold: summary.oversold.map((r) => r.ticker), obReturn: summary.obReturn.map((r) => r.ticker), osReturn: summary.osReturn.map((r) => r.ticker), events: summary.events.map((r) => r.ticker) } })
    .replace(/</g, '\\u003c');
  // TradingView 开源 K 线库（lightweight-charts，上层仓库 vendored 的同一份）内联：
  // K 线本地渲染零外网请求，墙内手机/离线双击都能看
  let tvLib = '';
  try { tvLib = readFileSync(path.join(HERE, '..', 'assets', 'lightweight-charts.standalone.production.js'), 'utf8'); }
  catch { tvLib = ''; /* 缺文件时详情弹层只显示文字信息，不崩 */ }
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>美股监控 ${meta.marketDate}</title>
<style>
:root{--bg:#f2f5f6;--surface:#fff;--surface-2:#f7f9f9;--ink:#16232b;--muted:#708087;--line:#dce5e7;--accent:#147d82;--accent-soft:#e5f3f2;--up:#c04b43;--down:#16815f;--warn:#a66a16;--shadow:0 16px 40px rgba(26,57,66,.08)}
@media(prefers-color-scheme:dark){:root{--bg:#11191c;--surface:#182326;--surface-2:#1d2b2f;--ink:#e8f0f1;--muted:#9aadb1;--line:#304348;--accent:#67c7c2;--accent-soft:#203d3e;--up:#f08073;--down:#61d1a3;--warn:#edb866;--shadow:0 16px 40px rgba(0,0,0,.18)}}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;color:var(--ink);background:var(--bg);font:14px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:24px 18px 40px}button{font:inherit;color:inherit}.wrap{max-width:1240px;margin:0 auto}.mut{color:var(--muted)}.up{color:var(--up)}.dn{color:var(--down)}.warn{color:var(--warn)}
.topbar{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding:8px 2px 22px;border-bottom:1px solid var(--line)}.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--accent);font-weight:800;text-transform:uppercase}.topbar h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:6px 0 7px}.topbar h1 span{font-size:15px;letter-spacing:0;font-weight:600;color:var(--muted);margin-left:8px}.subtitle{color:var(--muted);font-size:12px}.header-meta{display:flex;flex-direction:column;align-items:flex-end;gap:8px;color:var(--muted);font-size:12px;text-align:right}.status{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.status-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--line);background:var(--surface);border-radius:999px}.status-pill i{width:7px;height:7px;border-radius:50%;background:var(--accent);display:inline-block}.status-pill.alert i{background:var(--warn)}
.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:18px 0}.kpi{padding:14px 15px;background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}.kpi-label{color:var(--muted);font-size:12px}.kpi-value{font-size:25px;line-height:1.15;font-weight:750;margin-top:7px}.kpi-note{color:var(--muted);font-size:11px;margin-top:3px}
.signal-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(260px,1fr);gap:12px;margin-bottom:18px}.hero,.method{background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}.hero{padding:18px}.hero.empty{display:flex;align-items:center;min-height:170px}.section-kicker{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.hero-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.hero-title{font-size:18px;font-weight:750;margin:5px 0 0}.hero-price{font-size:31px;font-weight:800;line-height:1.05;margin-top:20px}.hero-price .change{font-size:14px;font-weight:700;margin-left:8px;vertical-align:middle}.hero-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:22px}.metric-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.rsi-value{font-size:24px;font-weight:750;margin-top:5px}.tunnel-list{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}.tunnel{padding:6px 8px;border:1px solid var(--line);background:var(--surface-2);border-radius:6px;font-size:12px}.tunnel b{display:block;font-size:11px;color:var(--muted);font-weight:600}.hero-notes{border-top:1px solid var(--line);margin-top:17px;padding-top:11px;color:var(--muted);font-size:12px}.method{padding:18px}.method h2{font-size:15px;margin:5px 0 12px}.method-row{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}.method-row:last-child{border-bottom:0}.method-row b{font-weight:650;text-align:right}.method-alert{margin-top:13px;padding:9px 10px;border-left:3px solid var(--warn);background:rgba(166,106,22,.1);color:var(--muted);font-size:12px}
.data-panel{background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);overflow:hidden}.toolbar{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding:18px 18px 14px}.toolbar h2{margin:3px 0 0;font-size:18px}.toolbar-note{color:var(--muted);font-size:12px;margin-top:3px}.chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.chip{border:1px solid var(--line);background:var(--surface-2);border-radius:999px;padding:6px 10px;cursor:pointer;font-size:12px;user-select:none;transition:background .15s,border-color .15s,color .15s}.chip:hover{border-color:var(--accent);color:var(--accent)}.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}.chip b{font-weight:750;margin-left:3px}.chip:focus-visible,.row-button:focus-visible,.close-x:focus-visible{outline:3px solid rgba(20,125,130,.35);outline-offset:2px}
.tblwrap{overflow:auto;max-height:65vh}.table{width:100%;border-collapse:collapse;font-size:13px;min-width:980px}.table th,.table td{padding:10px 11px;text-align:right;border-top:1px solid var(--line);white-space:nowrap}.table th{position:sticky;top:0;z-index:1;background:var(--surface-2);color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.03em}.table td:nth-child(2),.table th:nth-child(2),.table td:nth-child(3),.table th:nth-child(3){text-align:left}.table tbody tr{cursor:pointer;transition:background .15s}.table tbody tr:hover{background:var(--accent-soft)}.table tbody tr.ob td.rsi{color:var(--up);font-weight:800}.table tbody tr.os td.rsi{color:var(--down);font-weight:800}.ticker{font-weight:800;letter-spacing:.02em}.company{font-weight:600}.rank{color:var(--muted);font-variant-numeric:tabular-nums}.badge{display:inline-block;font-size:10px;line-height:1.5;border-radius:4px;padding:1px 5px;border:1px solid currentColor;margin-left:4px}.signal-badge{display:inline-block;padding:3px 6px;border-radius:4px;background:var(--accent-soft);color:var(--accent);font-size:11px}.table-empty{padding:30px;text-align:center;color:var(--muted)}.mobile-list{display:none}.row-button{width:100%;display:block;text-align:left;border:0;background:transparent;padding:0;cursor:pointer}
#detail{position:fixed;inset:0;background:rgba(8,20,24,.62);display:none;align-items:center;justify-content:center;padding:18px;z-index:5}#detail.on{display:flex}.panel{background:var(--surface);border:1px solid var(--line);border-radius:10px;max-width:680px;width:100%;max-height:90vh;overflow:auto;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.25)}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.panel h3{font-size:22px;line-height:1.2;margin:0}.panel .meta{color:var(--muted);font-size:12px;margin:7px 0 18px}.close-x{flex:0 0 auto;border:1px solid var(--line);background:var(--surface-2);border-radius:6px;width:32px;height:32px;cursor:pointer;font-size:20px;line-height:27px}.detail-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}.detail-stat{padding:11px;background:var(--surface-2);border-radius:6px}.detail-stat b{display:block;font-size:16px;margin-top:3px}.tvbox{height:420px;margin-top:10px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface-2)}.tvbox iframe{width:100%;height:100%;border:0}.tvcap{color:var(--muted);font-size:12px;margin-top:14px}.notes{font-size:12.5px}.notes div{padding:9px 0;border-top:1px solid var(--line)}.foot{color:var(--muted);font-size:12px;margin-top:16px;padding:0 2px}.foot strong{color:var(--ink);font-weight:650}
@media(max-width:900px){body{padding:18px 12px 30px}.topbar{align-items:flex-start;flex-direction:column;gap:13px}.header-meta{align-items:flex-start;text-align:left}.status{justify-content:flex-start}.kpis{grid-template-columns:repeat(3,1fr)}.signal-grid{grid-template-columns:1fr}.toolbar{align-items:flex-start;flex-direction:column}.chips{justify-content:flex-start}}
@media(max-width:620px){body{padding:12px 10px 26px}.topbar{padding-bottom:16px}.topbar h1{font-size:25px}.topbar h1 span{display:block;margin:5px 0 0;font-size:13px}.kpis{grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0}.kpi{padding:12px}.kpi-value{font-size:22px}.hero,.method{box-shadow:none}.hero-grid{grid-template-columns:1fr;gap:15px}.hero-price{margin-top:15px}.data-panel{box-shadow:none}.tblwrap{display:none}.mobile-list{display:grid;gap:7px;padding:0 10px 10px}.mobile-row{border:1px solid var(--line);border-radius:7px;padding:12px;background:var(--surface-2)}.mobile-top,.mobile-bottom{display:flex;justify-content:space-between;gap:12px;align-items:center}.mobile-top{margin-bottom:9px}.mobile-name{color:var(--muted);font-size:12px;margin-left:5px}.mobile-price{font-weight:800}.mobile-change{font-size:12px;font-weight:750;margin-left:5px}.mobile-rsi{font-weight:800}.mobile-meta{color:var(--muted);font-size:11px;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.toolbar{padding:15px 12px 12px}.toolbar h2{font-size:17px}.chip{padding:6px 8px}.detail-stats{grid-template-columns:repeat(2,1fr)}.panel{padding:18px 15px}.foot{font-size:11px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
svg{width:100%;height:auto;display:block}
</style></head><body>
<main class="wrap">
<header class="topbar"><div><div class="eyebrow">Market pulse / daily close</div><h1>美股监控 <span>${meta.marketDate} 收盘</span></h1><div class="subtitle">SP500 实时市值前 ${meta.topN} + SPMO · 生成于 ${meta.generatedAtLocal}</div></div><div class="header-meta"><div class="status" id="status"></div><div>数据源：东财 ${meta.srcEast} · Yahoo ${meta.srcYahoo ?? 0} · 腾讯兜底 ${meta.srcTx} · 失败 ${meta.srcFail}</div></div></header>
<section class="kpis" id="kpis" aria-label="市场摘要"></section>
<section class="signal-grid"><article class="hero" id="hero"></article><aside class="method"><div class="section-kicker">Method</div><h2>指标口径</h2><div class="method-row"><span>RSI6</span><b>Wilder RMA · &gt;${cfg.rsi.overbought} / &lt;${cfg.rsi.oversold}</b></div><div class="method-row"><span>Vegas 通道</span><b>EMA12/36 · 144/169 · 576/676</b></div><div class="method-row"><span>观察周期</span><b>日线收盘 · ${meta.marketDate}</b></div><div class="method-alert">页面只呈现收盘数据和信号事实，不构成投资建议。数据来自第三方公开接口。</div></aside></section>
<section class="data-panel"><div class="toolbar"><div><div class="section-kicker">Watchlist</div><h2>监控标的</h2><div class="toolbar-note" id="toolbar-note"></div></div><div class="chips" id="chips" role="group" aria-label="筛选监控标的"></div></div><div class="tblwrap"><table class="table" id="tbl"><thead><tr><th>排名</th><th>代码</th><th>名称</th><th>收盘</th><th>涨跌</th><th>RSI6</th><th>状态</th><th>短通道</th><th>主通道</th><th>长通道</th><th>SPMO%</th><th>事件</th></tr></thead><tbody></tbody></table></div><div class="mobile-list" id="mobile-list"></div></section>
<footer class="foot"><strong>口径：</strong>RSI6 = Wilder 平滑（同通达信/TradingView RMA）· EMA 种子 = 前 n 项 SMA · Vegas 三通道：短 EMA12/36 · 主 EMA144/169 · 长 EMA576/676。<br>指标只描述事实和常用读法，不构成投资建议。</footer>
</main><div id="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div class="panel" id="panel"></div></div>
<script>
${tvLib}
</script>
<script>
window.__REPORT__ = ${json};
</script>
<script>
const D=window.__REPORT__,POS={above:'上方',inside:'轨内',below:'下方'};
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const pct=v=>Number.isFinite(v)?(v>0?'+':'')+v.toFixed(2)+'%':'--';
const num=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'--';
const allRows=[D.spmo,...D.rows].filter(Boolean),byT={};allRows.forEach(r=>byT[r.ticker]=r);
const groups={all:{label:'全部',count:allRows.length},ob:{label:'超买',count:D.groups.overbought.length},os:{label:'超卖',count:D.groups.oversold.length},obr:{label:'超买回落',count:(D.groups.obReturn||[]).length},osr:{label:'超卖回升',count:(D.groups.osReturn||[]).length},ev:{label:'通道事件',count:D.groups.events.length},spmo:{label:'SPMO重合',count:D.rows.filter(r=>r.spmoPct!=null).length}};
let cur='all',lastFocus=null;
const status=document.getElementById('status'),statusItems=[];if(D.meta.srcEast)statusItems.push('<span class="status-pill"><i></i>东财 '+D.meta.srcEast+' 只</span>');if(D.meta.srcYahoo)statusItems.push('<span class="status-pill"><i></i>Yahoo '+D.meta.srcYahoo+' 只</span>');if(D.meta.srcTx)statusItems.push('<span class="status-pill alert"><i></i>腾讯兜底 '+D.meta.srcTx+' 只</span>');if(D.meta.srcFail)statusItems.push('<span class="status-pill alert"><i></i>失败 '+D.meta.srcFail+' 只</span>');status.innerHTML=statusItems.join('');
const kpis=document.getElementById('kpis');[['监控标的',allRows.length,'SPMO + 股票池'],['超买',D.groups.overbought.length,'RSI6 超过 '+D.cfg.rsi.overbought],['超卖',D.groups.oversold.length,'RSI6 低于 '+D.cfg.rsi.oversold],['通道事件',D.groups.events.length,'上下穿越 Vegas 通道'],['SPMO 重合',groups.spmo.count,'SPMO 持仓快照']].forEach(x=>{const el=document.createElement('div');el.className='kpi';el.innerHTML='<div class="kpi-label">'+x[0]+'</div><div class="kpi-value">'+x[1]+'</div><div class="kpi-note">'+x[2]+'</div>';kpis.appendChild(el)});
function tunnelHtml(t){if(!t||!t.pos)return '<span class="tunnel"><b>'+((t&&t.key)||'通道')+'</b><span class="mut">数据不足</span></span>';return '<span class="tunnel"><b>'+esc(t.key)+'</b><span class="'+(t.pos==='above'?'up':t.pos==='below'?'dn':'mut')+'">'+POS[t.pos]+(t.event&&t.event.startsWith('break')?' · 穿越':'')+'</span></span>'}
(function(){const h=document.getElementById('hero'),s=D.spmo;if(!s){h.className='hero empty';h.innerHTML='<div><div class="section-kicker">Core position</div><div class="hero-title">SPMO 今日暂无收盘数据</div><p class="mut">核心标的没有进入本次报告，股票池和筛选结果仍可正常查看。</p></div>';return}const state=s.rsi6&&s.rsi6.state,stateText=state==='overbought'?'超买':state==='oversold'?'超卖':'中性';h.innerHTML='<div class="hero-head"><div><div class="section-kicker">Core position · SPMO</div><div class="hero-title">'+esc(s.name||'标普500动量ETF')+'</div></div><span class="signal-badge">'+stateText+'</span></div><div class="hero-grid"><div><div class="hero-price">'+num(s.close)+' <span class="change '+(s.chgPct>=0?'up':'dn')+'">'+pct(s.chgPct)+'</span></div><div class="mut">截至 '+esc(s.asOf||D.meta.marketDate)+' 收盘 · '+esc(s.source||'--')+'</div></div><div><div class="metric-label">RSI6</div><div class="rsi-value '+(state==='overbought'?'up':state==='oversold'?'dn':'')+'">'+num(s.rsi6?s.rsi6.value:null,1)+'</div><div class="tunnel-list">'+(s.tunnels||[]).map(tunnelHtml).join('')+'</div></div></div><div class="hero-notes">'+(s.notes||[]).map(n=>esc(n.text)).join(' ')+'</div>'})();
const chips=document.getElementById('chips');Object.entries(groups).forEach(([k,v])=>{const el=document.createElement('button');el.type='button';el.className='chip'+(k===cur?' on':'');el.setAttribute('aria-pressed',k===cur?'true':'false');el.innerHTML=v.label+' <b>'+v.count+'</b>';el.onclick=()=>{cur=k;document.querySelectorAll('.chip').forEach(c=>{c.classList.remove('on');c.setAttribute('aria-pressed','false')});el.classList.add('on');el.setAttribute('aria-pressed','true');render()};chips.appendChild(el)});
function inGroup(r){if(cur==='all')return true;if(cur==='spmo')return r.spmoPct!=null;if(cur==='ob')return D.groups.overbought.includes(r.ticker);if(cur==='os')return D.groups.oversold.includes(r.ticker);if(cur==='obr')return (D.groups.obReturn||[]).includes(r.ticker);if(cur==='osr')return (D.groups.osReturn||[]).includes(r.ticker);return D.groups.events.includes(r.ticker)}
function posCell(t){if(!t||!t.pos)return '<span class="mut">--</span>';const ev=t.event&&t.event.startsWith('break');return '<span class="'+(t.pos==='above'?'up':t.pos==='below'?'dn':'mut')+'">'+POS[t.pos]+(ev?' ↑↑':'')+'</span>'}
function evTxt(r){const a=[];if(r.rsi6&&r.rsi6.cross)a.push({into_ob:'新进超买',into_os:'新进超卖',out_ob:'超买回落',out_os:'超卖回升'}[r.rsi6.cross]);(r.tunnels||[]).forEach(t=>{if(t.event&&t.event.startsWith('break'))a.push((t.event==='break_up'?'上穿':'下穿')+t.key)});return a.join('、')}
function stateText(r){return r.rsi6&&r.rsi6.state!=='neutral'?(r.rsi6.state==='overbought'?'超买':'超卖'):'中性'}
/* K 线：TradingView 开源库 lightweight-charts 本地渲染（内联进本页，零外网请求，墙内/离线可用）。
 * 蜡烛 = 我们的复权日K（后复权锚定现价）；六条 EMA 由服务端对全量历史算好切片传入。
 * 主题跟随系统深浅色；红涨绿跌与表格一致。图表库缺失时盒子留文字说明。 */
let kInst=null,kResize=null;
function drawK(r){const box=document.getElementById('tv-box');if(!box)return;
if(kInst){try{kInst.remove()}catch{}kInst=null}if(kResize){window.removeEventListener('resize',kResize);kResize=null}
if(!r.k||!window.LightweightCharts){box.innerHTML='<div style="height:100%;display:grid;place-items:center;font-size:13px" class="mut">K 线库未加载（仅影响图表，不影响数据）</div>';return}
const dark=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches;
const grid=dark?'#24333a':'#e7edef',textC=dark?'#9aadb1':'#708087';
const chart=LightweightCharts.createChart(box,{height:400,layout:{background:{type:'solid',color:'transparent'},textColor:textC,fontSize:11},grid:{vertLines:{color:grid},horzLines:{color:grid}},rightPriceScale:{borderColor:grid},timeScale:{borderColor:grid},crosshair:{mode:0}});
kInst=chart;
const candles=chart.addCandlestickSeries({upColor:'#c04b43',downColor:'#16815f',borderVisible:false,wickUpColor:'#c04b43',wickDownColor:'#16815f'});
candles.setData(r.k.d.map((d,i)=>({time:d,open:r.k.o[i],high:r.k.h[i],low:r.k.l[i],close:r.k.c[i]})));
const emaCfg=[['#8e7cc3','EMA12/36',0,1],['#8e7cc3','EMA36',1,1],['#e69138','EMA144',2,1.5],['#e69138','EMA169',3,1.5],['#3d85c6','EMA576',4,1],['#3d85c6','EMA676',5,1]];
emaCfg.forEach(([col,,idx,w])=>{const pts=r.k.d.map((d,i)=>({time:d,value:r.k.e[idx][i]})).filter(p=>p.value!=null);if(pts.length)chart.addLineSeries({color:col,lineWidth:w,priceLineVisible:false,lastValueVisible:false}).setData(pts)});
chart.timeScale().fitContent();
kResize=()=>{try{chart.applyOptions({width:box.clientWidth})}catch{}};kResize();window.addEventListener('resize',kResize)}
function openRow(tk,button){lastFocus=button||document.activeElement;show(tk)}
function render(){const visible=allRows.filter(inGroup),tb=document.querySelector('#tbl tbody'),ml=document.getElementById('mobile-list');tb.innerHTML='';ml.innerHTML='';document.getElementById('toolbar-note').textContent='当前显示 '+visible.length+' 只 · 点击任意标的查看数据口径与备注';if(!visible.length){tb.innerHTML='<tr><td class="table-empty" colspan="12">当前筛选没有匹配标的</td></tr>';ml.innerHTML='<div class="table-empty">当前筛选没有匹配标的</div>';return}visible.forEach(r=>{const tr=document.createElement('tr');tr.className=r.rsi6&&r.rsi6.state==='overbought'?'ob':r.rsi6&&r.rsi6.state==='oversold'?'os':'';tr.tabIndex=0;tr.setAttribute('role','button');tr.setAttribute('aria-label',r.ticker+' '+r.name+' 详情');tr.innerHTML='<td class="rank">'+(r.rank??'★')+'</td><td><span class="ticker">'+esc(r.ticker)+'</span></td><td><span class="company">'+esc(r.name)+'</span>'+(r.adj==='raw'?' <span class="warn badge">不复权</span>':'')+'</td><td>'+num(r.close)+'</td><td class="'+(r.chgPct>=0?'up':'dn')+'">'+pct(r.chgPct)+'</td><td class="rsi">'+num(r.rsi6?r.rsi6.value:null,1)+'</td><td><span class="signal-badge">'+stateText(r)+'</span></td><td>'+posCell((r.tunnels||[])[0])+'</td><td>'+posCell((r.tunnels||[])[1])+'</td><td>'+posCell((r.tunnels||[])[2])+'</td><td>'+(r.spmoPct!=null?r.spmoPct.toFixed(1)+'%':'--')+'</td><td class="mut">'+esc(evTxt(r)||'--')+'</td>';tr.onclick=()=>openRow(r.ticker,tr);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openRow(r.ticker,tr)}};tb.appendChild(tr);const card=document.createElement('div');card.className='mobile-row';card.innerHTML='<button class="row-button" type="button" aria-label="查看 '+esc(r.ticker)+' 详情"><div class="mobile-top"><div><span class="ticker">'+esc(r.ticker)+'</span><span class="mobile-name">'+esc(r.name)+'</span></div><div class="mobile-price">'+num(r.close)+' <span class="mobile-change '+(r.chgPct>=0?'up':'dn')+'">'+pct(r.chgPct)+'</span></div></div><div class="mobile-bottom"><span class="signal-badge">'+stateText(r)+'</span><span class="mobile-rsi">RSI6 '+num(r.rsi6?r.rsi6.value:null,1)+'</span><span class="mut">'+(r.spmoPct!=null?'SPMO '+r.spmoPct.toFixed(1)+'%':'#'+(r.rank??'SPMO'))+'</span></div><div class="mobile-meta">短 '+(r.tunnels?.[0]?.pos?POS[r.tunnels[0].pos]:'--')+' · 主 '+(r.tunnels?.[1]?.pos?POS[r.tunnels[1].pos]:'--')+' · '+(evTxt(r)||'无事件')+'</div></button>';card.querySelector('button').onclick=()=>openRow(r.ticker,card.querySelector('button'));ml.appendChild(card)})}
function show(tk){const r=byT[tk];if(!r)return;const detail=document.getElementById('detail'),p=document.getElementById('panel'),state=stateText(r);p.innerHTML='<div class="panel-head"><div><div class="section-kicker">Instrument detail</div><h3 id="detail-title">'+esc(r.ticker)+' · '+esc(r.name)+'</h3><div class="meta">'+(r.rank?'市值排名 #'+r.rank+' · ':'')+'截至 '+esc(r.asOf||D.meta.marketDate)+' 收盘</div></div><button class="close-x" id="detail-close" type="button" aria-label="关闭详情">×</button></div><div class="detail-stats"><div class="detail-stat"><span class="metric-label">收盘</span><b>'+num(r.close)+'</b></div><div class="detail-stat"><span class="metric-label">涨跌</span><b class="'+(r.chgPct>=0?'up':'dn')+'">'+pct(r.chgPct)+'</b></div><div class="detail-stat"><span class="metric-label">RSI6</span><b class="'+(state==='超买'?'up':state==='超卖'?'dn':'')+'">'+num(r.rsi6?r.rsi6.value:null,1)+' · '+state+'</b></div></div><div class="method-row"><span>数据口径</span><b>'+esc(r.source||'--')+' · '+(r.adj==='hfq'?'后复权':'不复权')+' · '+(r.bars||'--')+' 根</b></div><div class="method-row"><span>Vegas 通道</span><b>'+((r.tunnels||[]).map(t=>esc(t.key)+' '+(t.pos?POS[t.pos]:'数据不足')).join(' · ')||'--')+'</b></div>'+(r.spmoPct!=null?'<div class="method-row"><span>SPMO 持仓</span><b>'+r.spmoPct.toFixed(2)+'%</b></div>':'')+'<div class="notes">'+(r.notes||[]).map(n=>'<div>['+esc(n.tag)+'] '+esc(n.text)+'</div>').join('')+'</div><div class="tvcap">K 线 · TradingView 开源库 lightweight-charts 本地渲染（复权日K，零外网请求，离线可用；紫=短通道12/36 · 橙=主通道144/169 · 蓝=长通道576/676）· <a href="https://www.tradingview.com/chart/?symbol='+encodeURIComponent(r.tvSymbol||r.ticker)+'" target="_blank" rel="noopener">TradingView 打开 ↗</a></div><div class="tvbox" id="tv-box"></div>';detail.classList.add('on');drawK(r);document.getElementById('detail-close').focus();document.getElementById('detail-close').onclick=closeDetail}
function closeDetail(){document.getElementById('detail').classList.remove('on');if(lastFocus&&lastFocus.focus)lastFocus.focus()}
document.getElementById('detail').onclick=e=>{if(e.target.id==='detail')closeDetail()};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('detail').classList.contains('on'))closeDetail()});render();
</script></body></html>`;
}

/* ---------- 写文件 ---------- */
export function writeOutputs(data, outDir, opts = {}) {
  mkdirSync(outDir, { recursive: true });
  const outputs = [];
  const today = data.meta.marketDate;
  const files = {
    json: path.join(outDir, 'latest.json'),
    csv: path.join(outDir, `report-${today}.csv`),
    html: path.join(outDir, 'report.html'),
  };
  writeFileSync(files.json, JSON.stringify(jsonPayload(data), null, 1));
  outputs.push(files.json);
  if (opts.csv !== false) { writeFileSync(files.csv, csvPayload(data)); outputs.push(files.csv); }
  if (opts.html !== false) { writeFileSync(files.html, htmlPayload(data)); outputs.push(files.html); }
  return outputs;
}
