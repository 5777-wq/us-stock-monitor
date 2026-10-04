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
  const wk = r.wk || null;
  const wt = wk ? wk.tunnels || [] : [];
  const wpos = wk ? wt.map((x) => (x && x.pos ? POS_TXT[x.pos] : '·')).join('') : '--';
  const ev = [];
  if (r.rsi6 && r.rsi6.cross === 'into_ob') ev.push('新进超买');
  if (r.rsi6 && r.rsi6.cross === 'into_os') ev.push('新进超卖');
  if (r.rsi6 && r.rsi6.cross === 'out_ob') ev.push('超买回落');
  if (r.rsi6 && r.rsi6.cross === 'out_os') ev.push('超卖回升');
  for (const x of t) if (x.event && x.event.startsWith('break')) ev.push((x.event === 'break_up' ? '上穿' : '下穿') + x.key);
  if (wk && wk.rsi6) {
    if (wk.rsi6.cross === 'into_ob') ev.push('周新进超买');
    if (wk.rsi6.cross === 'into_os') ev.push('周新进超卖');
    if (wk.rsi6.cross === 'out_ob') ev.push('周超买回落');
    if (wk.rsi6.cross === 'out_os') ev.push('周超卖回升');
  }
  if (wk) for (const x of wt) if (x.event && x.event.startsWith('break')) ev.push((x.event === 'break_up' ? '周上穿' : '周下穿') + x.key);
  const idx = r.rank == null ? [[r.sp500, '标普'], [r.ndx, '纳指']].filter((x) => x[0]).map((x) => x[1]).join('+') || '--' : (r.ndx ? '标普+纳指' : '');
  return [
    pad(r.rank ?? '★', 4, true),
    pad(r.ticker, 7),
    pad(clip(r.name, 18), 19),
    pad(fmtNum(r.close), 9, true),
    pad(fmtPct(r.chgPct), 7, true),
    pad(r.rsi6 ? fmtNum(r.rsi6.value, 1) : '--', 6, true),
    pad(r.rsi6 ? RSI_TXT[r.rsi6.state] : '--', 4),
    pad(r.rsi14 ? fmtNum(r.rsi14.value, 1) : '--', 6, true),
    pad(tun(0), 3, true), pad(tun(1), 3, true), pad(tun(2), 3, true),
    pad(wk && wk.rsi6 ? fmtNum(wk.rsi6.value, 1) : '--', 6, true),
    pad(wk && wk.rsi6 ? wpos : '--', 7),
    pad(idx, 9),
    pad(r.spmoPct !== null && r.spmoPct !== undefined ? fmtNum(r.spmoPct, 1) + '%' : '', 6, true),
    pad((r.adj === 'raw' ? '[不复权] ' : '') + ev.join(','), 26),
  ].join(' ');
}

const HEAD = ['排名', '代码', '名称', '收盘', '涨跌', 'RSI6', '状态', 'RSI14', '短', '中', '长', '周RSI', '周通道', '成分', 'SPMO%', '事件'];
const COLW = [4, 7, 19, 9, 7, 6, 4, 6, 3, 3, 3, 6, 7, 9, 6, 26];

/* ---------- 控制台 ---------- */
export function consoleReport(data) {
  const L = [];
  const { meta, spmo, rows, summary } = data;
  L.push('═'.repeat(96));
  L.push(`Meridian · ${meta.marketDate} 收盘${meta.liveCount ? `（盘中另见 live 参考，共 ${meta.liveCount} 只含未收盘 bar）` : ''} · 生成于 ${meta.generatedAtLocal}`);
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

  const watchRows = [spmo, ...rows].filter((r) => r && r.watch);
  const watchFailed = (data.failed || []).filter((f) => f.watch);
  if (watchRows.length || watchFailed.length) {
    L.push('');
    L.push(`◆ 自选持仓（${watchRows.length}）—— config.watchlist · 池内标的在全表打标，池外标的单独取数`);
    for (const r of watchRows) {
      L.push('  ' + rowLine(r));
      if (r.note) L.push(`    · [备注] ${r.note}`);
    }
    if (watchFailed.length) L.push('  ✗ 取数失败：' + watchFailed.map((f) => f.ticker).join(' '));
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

  // 周线榜单：与日线同一套逻辑（RSI6/三通道/回归），序列是周线
  const allW = [spmo, ...rows].filter((r) => r && r.wk && r.wk.rsi6);
  const wOk = allW.filter((r) => r.wk.rsi6.state === 'overbought').sort((a, b) => b.wk.rsi6.value - a.wk.rsi6.value);
  const wOs = allW.filter((r) => r.wk.rsi6.state === 'oversold').sort((a, b) => a.wk.rsi6.value - b.wk.rsi6.value);
  const wRet = allW.filter((r) => r.wk.rsi6.cross === 'out_ob' || r.wk.rsi6.cross === 'out_os');
  section('周线超买 周RSI6 > ' + data.cfg.rsi.overbought, wOk, '周线口径，同日线逻辑：波段高位观察');
  section('周线超卖 周RSI6 < ' + data.cfg.rsi.oversold, wOs, '周线口径：波段低位观察分批吸纳');
  section('周线回归 周RSI6 回到正常区', wRet, '前一周超买/超卖 → 本周回到正常区');

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
  L.push('口径：RSI6=Wilder 平滑（同通达信/TradingView RMA）；EMA 种子=前 n 项 SMA；三通道=' + data.cfg.tunnels.map((t) => t.key + '=EMA' + t.n.join('/')).join(' · ') + '；周线=日线按周重采样（周五标签）后同参重算。');
  L.push('声明：指标只描述事实与常用读法，不构成投资建议。');
  return L.join('\n');
}

/* ---------- JSON ---------- */
function jsonPayload(data) {
  const { meta, spmo, rows, summary, cfg } = data;
  const slim = (r) => r && ({
    ticker: r.ticker, name: r.name, rank: r.rank, mcapUsd: r.mcapUsd, spmoPct: r.spmoPct,
    sp500: r.sp500 ?? undefined, ndx: r.ndx || undefined,
    asOf: r.asOf, close: r.close, chgPct: r.chgPct,
    rsi6: r.rsi6, rsi14: r.rsi14 || undefined, tunnels: r.tunnels,
    wk: r.wk ? { asOf: r.wk.asOf, bars: r.wk.bars, rsi6: r.wk.rsi6, rsi14: r.wk.rsi14 || undefined, tunnels: r.wk.tunnels, live: r.wk.live } : undefined,
    live: r.live, adj: r.adj, anchored: r.anchored || false, tvSymbol: r.tvSymbol || r.ticker, source: r.source, bars: r.bars, notes: r.notes,
    watch: r.watch || undefined, note: r.note || undefined,
  });
  const all = [data.spmo, ...rows].filter(Boolean);
  const wOk = all.filter((r) => r.wk && r.wk.rsi6 && r.wk.rsi6.state === 'overbought').map((r) => r.ticker);
  const wOs = all.filter((r) => r.wk && r.wk.rsi6 && r.wk.rsi6.state === 'oversold').map((r) => r.ticker);
  const wRet = all.filter((r) => r.wk && r.wk.rsi6 && (r.wk.rsi6.cross === 'out_ob' || r.wk.rsi6.cross === 'out_os')).map((r) => r.ticker);
  const watchTickers = [
    ...(data.spmo && data.spmo.watch ? [data.spmo.ticker] : []),
    ...rows.filter((r) => r.watch).map((r) => r.ticker),
  ];
  return {
    version: 1,
    strategy: 'SPMO 攒股 + SP500前150 增强 · 日线+周线 RSI6 超买超卖 + Vegas 三通道',
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
      weekOverbought: wOk,
      weekOversold: wOs,
      weekReturn: wRet,
      watch: watchTickers,
    },
  };
}

/* ---------- CSV（UTF-8 BOM，Excel 直开） ---------- */
function csvPayload(data) {
  const cell = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ['排名', '代码', '名称', '市值亿USD', '收盘', '涨跌%', 'RSI6', 'RSI前值', 'RSI状态', 'RSI穿越', 'RSI14', 'RSI14状态', 'RSI14穿越', '短通道', '中通道', '长通道', '周RSI6', '周RSI状态', '周RSI穿越', '周RSI14', '周RSI14状态', '周通道', '成分', '通道事件', 'SPMO持仓%', '自选备注', '数据源', '复权', '截至'];
  const pos = (t) => (t && t.pos ? { above: '上', inside: '内', below: '下' }[t.pos] : '');
  const ev = (r) => {
    const a = [];
    if (r.rsi6?.cross === 'into_ob') a.push('新进超买');
    if (r.rsi6?.cross === 'into_os') a.push('新进超卖');
    if (r.rsi6?.cross === 'out_ob') a.push('超买回落');
    if (r.rsi6?.cross === 'out_os') a.push('超卖回升');
    for (const t of r.tunnels || []) if (t.event) a.push(t.key + ':' + t.event);
    if (r.wk && r.wk.rsi6) {
      if (r.wk.rsi6.cross === 'into_ob') a.push('周新进超买');
      if (r.wk.rsi6.cross === 'into_os') a.push('周新进超卖');
      if (r.wk.rsi6.cross === 'out_ob') a.push('周超买回落');
      if (r.wk.rsi6.cross === 'out_os') a.push('周超卖回升');
    }
    for (const t of (r.wk && r.wk.tunnels) || []) if (t.event) a.push('周' + t.key + ':' + t.event);
    return a.join('|');
  };
  const idx = (r) => {
    const a = [];
    if (r.sp500) a.push('SP500');
    if (r.ndx) a.push('纳指100');
    return a.join('+') || (r.rank == null ? '池外' : '');
  };
  const line = (r) => [r.rank ?? 'SPMO', r.ticker, r.name, r.mcapUsd ? (r.mcapUsd / 1e8).toFixed(0) : '', r.close, r.chgPct?.toFixed(2) ?? '', r.rsi6?.value?.toFixed(2) ?? '', r.rsi6?.prev?.toFixed(2) ?? '', RSI_TXT[r.rsi6?.state] ?? '', r.rsi6?.cross ?? '', r.rsi14?.value?.toFixed(2) ?? '', RSI_TXT[r.rsi14?.state] ?? '', r.rsi14?.cross ?? '', pos(r.tunnels?.[0]), pos(r.tunnels?.[1]), pos(r.tunnels?.[2]), r.wk?.rsi6?.value?.toFixed(2) ?? '', RSI_TXT[r.wk?.rsi6?.state] ?? '', r.wk?.rsi6?.cross ?? '', r.wk?.rsi14?.value?.toFixed(2) ?? '', RSI_TXT[r.wk?.rsi14?.state] ?? '', (r.wk?.tunnels || []).map(pos).join(''), idx(r), ev(r), r.spmoPct ?? '', r.watch ? (r.note || '自选') : '', r.source, r.adj, r.asOf].map(cell).join(',');
  return '\uFEFF' + [head.join(','), ...[data.spmo, ...data.rows].filter(Boolean).map(line)].join('\r\n') + '\r\n';
}

/* ---------- HTML（自包含） ---------- */
/* K 线数据不内联：拆到 out/klines.json（与报告同 commit），详情弹层打开时才拉取。
   报告页因此从 ~2.4MB 降到 ~0.6MB；klines.json 由 SW 网络优先缓存。 */
const slimK = (r) => {
  if (!r || (!r.k && !(r.wk && r.wk.k))) return r;
  const o = { ...r };
  delete o.k;
  if (o.wk) { const { k: _k, ...w } = o.wk; o.wk = w; }
  return o;
};
function klinePayload(data) {
  const out = {};
  for (const r of [data.spmo, ...data.rows].filter(Boolean)) {
    if (!r.k && !(r.wk && r.wk.k)) continue;
    const e = { ...(r.k || {}) };
    if (r.wk && r.wk.k) e.wk = r.wk.k;
    out[r.ticker] = e;
  }
  return Object.keys(out).length ? out : null;
}
export function htmlPayload(data) {
  const { meta, cfg, summary } = data;
  // rows 已是不含 SPMO 的股票行；SPMO 单独内联，页面端拼 [D.spmo, ...D.rows]（别重复拼）
  const pageRows = data.rows.filter(Boolean).map(slimK);
  const spmoRow = slimK(data.spmo);
  const wAll = [data.spmo, ...pageRows].filter((r) => r && r.wk && r.wk.rsi6);
  const json = JSON.stringify({ meta, cfg, spmo: spmoRow, rows: pageRows, groups: { overbought: summary.overbought.map((r) => r.ticker), oversold: summary.oversold.map((r) => r.ticker), obReturn: summary.obReturn.map((r) => r.ticker), osReturn: summary.osReturn.map((r) => r.ticker), events: summary.events.map((r) => r.ticker), weekOverbought: wAll.filter((r) => r.wk.rsi6.state === 'overbought').map((r) => r.ticker), weekOversold: wAll.filter((r) => r.wk.rsi6.state === 'oversold').map((r) => r.ticker), weekReturn: wAll.filter((r) => r.wk.rsi6.cross === 'out_ob' || r.wk.rsi6.cross === 'out_os').map((r) => r.ticker), watch: [...(data.spmo && data.spmo.watch ? [data.spmo.ticker] : []), ...pageRows.filter((r) => r.watch).map((r) => r.ticker)] } })
    .replace(/</g, '\\u003c');
  // TradingView 开源 K 线库（lightweight-charts，上层仓库 vendored 的同一份）内联：
  // K 线本地渲染零外网请求，墙内手机/离线双击都能看
  let tvLib = '';
  try { tvLib = readFileSync(path.join(HERE, '..', 'assets', 'lightweight-charts.standalone.production.js'), 'utf8'); }
  catch { tvLib = ''; /* 缺文件时详情弹层只显示文字信息，不崩 */ }
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="manifest" href="../manifest.webmanifest"><meta name="theme-color" content="#002FA7">
<link rel="apple-touch-icon" href="../assets/pwa/apple-touch-icon.png"><link rel="icon" type="image/png" href="../assets/pwa/icon-192.png">
<script>if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('../sw.js')})</script>
<title>Meridian · ${meta.marketDate} 收盘</title>
<style>
:root{--bg:#f2f5f6;--surface:#fff;--surface-2:#f7f9f9;--ink:#16232b;--muted:#708087;--line:#dce5e7;--accent:#002FA7;--accent-soft:#e4eafb;--up:#c04b43;--down:#16815f;--warn:#a66a16;--shadow:none;--ease-tg:cubic-bezier(.38,.7,.125,1);--ease-pop:cubic-bezier(.22,1.12,.36,1);--ease-bounce:cubic-bezier(.34,1.45,.64,1);--hl:rgba(0,0,0,.07)}
@media(prefers-color-scheme:dark){:root{--bg:#11191c;--surface:#182326;--surface-2:#1d2b2f;--ink:#e8f0f1;--muted:#9aadb1;--line:#304348;--accent:#82A7FF;--accent-soft:#1b2547;--up:#f08073;--down:#61d1a3;--warn:#edb866;--shadow:none;--hl:rgba(255,255,255,.09)}}
*{box-sizing:border-box}html{background:var(--bg);scrollbar-width:thin}body{margin:0;color:var(--ink);background:var(--bg);font:14px/1.55 "Helvetica Neue",Helvetica,Arial,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:24px 18px 48px}::selection{background:var(--accent-soft)}button{font:inherit;color:inherit}.wrap{max-width:1240px;margin:0 auto}.mut{color:var(--muted)}.up{color:var(--up)}.dn{color:var(--down)}.warn{color:var(--warn)}
.topbar{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding:8px 2px 22px;border-bottom:2px solid var(--ink)}.brandrow{display:flex;gap:14px;align-items:flex-start}.brand-mark{width:40px;height:40px;flex:0 0 auto;border-radius:4px;margin-top:3px}.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--accent);font-weight:700;text-transform:uppercase}.topbar h1{font-size:34px;line-height:1.08;letter-spacing:-.03em;margin:6px 0 7px;font-weight:750}.topbar h1 span{font-size:15px;letter-spacing:0;font-weight:500;color:var(--muted);margin-left:8px}.subtitle{color:var(--muted);font-size:12px}.header-meta{display:flex;flex-direction:column;align-items:flex-end;gap:8px;color:var(--muted);font-size:12px;text-align:left}.status{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.status-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--line);background:var(--surface);border-radius:2px}.status-pill i{width:7px;height:7px;border-radius:50%;background:var(--accent);display:inline-block}.status-pill.alert i{background:var(--warn)}.app-cta{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:2px;background:var(--accent);color:#fff;text-decoration:none;font-size:12.5px;font-weight:700;letter-spacing:.01em;transition:transform .15s,filter .15s}.app-cta svg{width:19px;height:19px;flex:0 0 auto}.app-cta:hover{filter:brightness(1.15)}.app-cta small{font-weight:600;opacity:.82;font-size:11px}.app-cta:focus-visible{outline:3px solid rgba(0,47,167,.35);outline-offset:2px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:10px;margin:20px 0}.boot{grid-column:1/-1;padding:26px 4px;text-align:center;color:var(--muted);font-size:13px}.kpi{position:relative;padding:12px 12px 0 0;border-top:2px solid var(--ink);transition:background .2s cubic-bezier(0,0,.2,1)}.kpi:active{background:var(--hl);transition:none}.kpi-label{color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.kpi-value{font-size:38px;line-height:1.05;font-weight:750;margin-top:8px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.kpi-note{color:var(--muted);font-size:11px;margin-top:4px}
.signal-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(260px,1fr);gap:12px;margin-bottom:18px}.hero,.method{background:var(--surface);border:1px solid var(--line);border-radius:2px}.hero{padding:18px}.hero.empty{display:flex;align-items:center;min-height:170px}.section-kicker{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.hero-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.hero-title{font-size:18px;font-weight:750;margin:5px 0 0}.hero-price{font-size:36px;font-weight:750;line-height:1.02;margin-top:20px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.hero-price .change{font-size:14px;font-weight:700;margin-left:8px;vertical-align:middle}.hero-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:22px}.metric-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.rsi-value{font-size:26px;font-weight:750;margin-top:5px;font-variant-numeric:tabular-nums}.tunnel-list{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}.tunnel{padding:6px 8px;border:1px solid var(--line);background:var(--surface-2);border-radius:2px;font-size:12px}.tunnel b{display:block;font-size:11px;color:var(--muted);font-weight:600}.hero-notes{border-top:1px solid var(--line);margin-top:17px;padding-top:11px;color:var(--muted);font-size:12px}.method{padding:18px}.method h2{font-size:15px;margin:5px 0 12px}.method-row{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}.method-row:last-child{border-bottom:0}.method-row b{font-weight:650;text-align:right}.method-alert{margin-top:13px;padding:9px 10px;border-left:3px solid var(--warn);background:rgba(166,106,22,.1);color:var(--muted);font-size:12px}
.data-panel{background:var(--surface);border:1px solid var(--line);border-radius:2px;overflow:hidden}.toolbar{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding:18px 18px 14px}.toolbar h2{margin:3px 0 0;font-size:18px}.toolbar-note{color:var(--muted);font-size:12px;margin-top:3px}.chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.chip{border:1px solid var(--line);background:var(--surface-2);border-radius:2px;padding:6px 10px;cursor:pointer;font-size:12px;user-select:none;transition:background .2s cubic-bezier(0,0,.2,1),border-color .15s,color .15s}.chip:hover{border-color:var(--accent);color:var(--accent)}.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}.chip b{font-weight:750;margin-left:3px}.chip:focus-visible,.row-button:focus-visible,.close-x:focus-visible{outline:3px solid rgba(0,47,167,.35);outline-offset:2px}
.tblwrap{overflow:auto;max-height:65vh;scrollbar-width:thin}.table{width:100%;border-collapse:collapse;font-size:13px;min-width:980px;font-variant-numeric:tabular-nums}.table th,.table td{padding:10px 11px;text-align:right;border-top:1px solid var(--line);white-space:nowrap}.table th{position:sticky;top:0;z-index:1;background:var(--surface-2);color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.03em;box-shadow:0 1px 0 var(--line)}.table td:nth-child(3),.table th:nth-child(3),.table td:nth-child(4),.table th:nth-child(4){text-align:left}.table tbody tr{cursor:pointer;transition:background .15s}.table tbody tr:hover{background:var(--accent-soft)}.table tbody tr.ob td.rsi{color:var(--up);font-weight:800}.table tbody tr.os td.rsi{color:var(--down);font-weight:800}.ticker{font-weight:800;letter-spacing:.02em}.company{font-weight:600}.rank{color:var(--muted);font-variant-numeric:tabular-nums}.badge{display:inline-block;font-size:10px;line-height:1.5;border-radius:4px;padding:1px 5px;border:1px solid currentColor;margin-left:4px}.note-badge{color:var(--accent);font-weight:700}.idx-badge{color:#3d85c6;font-weight:700}.signal-badge{display:inline-block;padding:3px 6px;border-radius:4px;background:var(--accent-soft);color:var(--accent);font-size:11px}.sig{max-width:360px;white-space:normal}.tagx{display:inline-block;font-size:10.5px;line-height:1.7;border-radius:4px;padding:0 5px;margin:1px 3px 1px 0;border:1px solid var(--line);white-space:nowrap;cursor:default;vertical-align:middle}.tagx.fill-up{background:var(--up);border-color:var(--up);color:#fff}.tagx.fill-dn{background:var(--down);border-color:var(--down);color:#fff}.tagx.o-up{color:var(--up)}.tagx.o-dn{color:var(--down)}.tagx.acc{color:var(--accent);border-color:var(--accent);font-weight:700}.table-empty{padding:30px;text-align:center;color:var(--muted)}.mobile-list{display:none}.row-button{width:100%;display:block;text-align:left;border:0;background:transparent;padding:0;cursor:pointer}
.charttabs{display:inline-flex;gap:5px;margin:0 6px;vertical-align:middle}.charttab{border:1px solid var(--line);background:var(--surface-2);border-radius:2px;padding:3px 11px;cursor:pointer;font-size:12px;color:var(--muted)}.charttab.on{background:var(--accent);border-color:var(--accent);color:#fff}.wktun b{font-weight:800;margin-right:2px}.tunrow{display:flex;align-items:baseline;justify-content:flex-start;gap:8px;line-height:1.5}.tunrow .tf{font-size:10px;font-weight:700;color:var(--muted);flex:0 0 auto;width:11px}.tunrow b{font-weight:750;font-size:12.5px;font-variant-numeric:tabular-nums}.tunrow b.up{color:var(--up)}.tunrow b.dn{color:var(--down)}.tp{font-size:12px;font-weight:750;white-space:nowrap}.tp i{font-style:normal;font-size:10px;font-weight:600;color:var(--muted);margin-right:1px}.tp.up{color:var(--up)}.tp.dn{color:var(--down)}.tp.ins{color:var(--ink)}.tp.na{color:var(--muted);opacity:.55}.tp.ev{text-decoration:underline;text-underline-offset:2px}.table th:nth-child(8),.table td:nth-child(8){text-align:left}.table th:nth-child(9),.table td:nth-child(9),.table td.sig{text-align:left}
.tool-right{display:flex;flex-direction:column;align-items:flex-end;gap:9px}.searchbox{position:relative}.searchbox input{border:1px solid var(--line);background:var(--surface-2);border-radius:2px;padding:7px 14px;font:inherit;font-size:12.5px;color:var(--ink);min-width:240px;outline:none}.searchbox input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(0,47,167,.15)}.add-sug{position:absolute;top:calc(100% + 4px);right:0;z-index:3;background:var(--surface);border:1px solid var(--line);border-radius:2px;padding:6px}.add-sug button{border:1px solid var(--accent);color:var(--accent);background:var(--accent-soft);border-radius:2px;padding:6px 10px;cursor:pointer;font-size:12px}
.star{border:0;background:transparent;cursor:pointer;font-size:15px;line-height:1;color:#c9a227;padding:2px 4px;font-family:inherit}.star.off{color:var(--muted);opacity:.4}.star:focus-visible{outline:3px solid rgba(0,47,167,.35);outline-offset:2px;border-radius:4px}td.stcol,th.stcol{text-align:center!important;width:36px}.cardstar{font-size:16px;margin:0 2px}.headbtns{display:flex;gap:8px;flex:0 0 auto}.headbtns .star{font-size:19px;width:32px;height:32px;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);color:#c9a227;opacity:1}.headbtns .star.off{color:var(--muted);opacity:.55}.copy-btn{border:1px solid var(--line);background:var(--surface-2);border-radius:2px;padding:6px 12px;cursor:pointer;font-size:12px;color:var(--muted)}.copy-btn:hover{border-color:var(--accent);color:var(--accent)}
.watch-panel{margin-bottom:18px}.watch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;padding:0 18px 18px}.watch-card{border:1px solid var(--line);background:var(--surface-2);border-radius:2px;padding:13px 14px;text-align:left;cursor:pointer;font:inherit;color:inherit;transition:border-color .15s,background .15s}.watch-card:hover{border-color:var(--accent);background:var(--accent-soft)}.watch-card:focus-visible{outline:3px solid rgba(0,47,167,.35);outline-offset:2px}.wc-top{display:flex;align-items:baseline;gap:5px}.wc-price{margin-left:auto;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.wc-price .up,.wc-price .dn{font-size:12px;font-weight:750;margin-left:4px}.wc-sub{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:5px;font-size:12px}.wc-sub .company{color:var(--muted);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wc-foot{font-size:11px;margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#detail{position:fixed;inset:0;background:rgba(8,20,24,.62);display:none;align-items:center;justify-content:center;padding:18px;z-index:5}#detail.on{display:flex}.panel{background:var(--surface);border:1px solid var(--line);border-radius:2px;max-width:680px;width:100%;max-height:90vh;overflow:auto;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.28)}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.panel h3{font-size:22px;line-height:1.2;margin:0;letter-spacing:-.01em}.panel .meta{color:var(--muted);font-size:12px;margin:7px 0 18px}.close-x{flex:0 0 auto;border:1px solid var(--line);background:var(--surface-2);border-radius:2px;width:32px;height:32px;cursor:pointer;font-size:20px;line-height:27px}.detail-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}.detail-stat{padding:11px;background:var(--surface-2);border-radius:2px}.detail-stat b{display:block;font-size:16px;margin-top:3px;font-variant-numeric:tabular-nums}.tvbox{height:420px;margin-top:10px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface-2)}.tvbox iframe{width:100%;height:100%;border:0}.tvcap{color:var(--muted);font-size:12px;margin-top:14px}.notes{font-size:12.5px}.notes div{padding:9px 0;border-top:1px solid var(--line)}.foot{color:var(--muted);font-size:12px;margin-top:16px;padding:0 2px}.foot strong{color:var(--ink);font-weight:650}
@media(max-width:900px){body{padding:18px 12px 30px}.topbar{align-items:flex-start;flex-direction:column;gap:13px}.header-meta{align-items:flex-start;text-align:left}.status{justify-content:flex-start}.kpis{grid-template-columns:repeat(3,1fr)}.signal-grid{grid-template-columns:1fr}.toolbar{align-items:flex-start;flex-direction:column}.chips{justify-content:flex-start}.tool-right{align-items:stretch;width:100%}.searchbox input{width:100%;min-width:0}.watch-grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}}
@media(max-width:620px){body{padding:12px 10px 26px}.topbar{padding-bottom:16px}.topbar h1{font-size:27px}.topbar h1 span{display:block;margin:5px 0 0;font-size:13px}.kpis{grid-template-columns:repeat(2,1fr);gap:8px;margin:12px 0}.kpi{padding-right:6px}.kpi-value{font-size:30px}.hero,.method{box-shadow:none}.hero-grid{grid-template-columns:1fr;gap:15px}.hero-price{margin-top:15px}.data-panel{box-shadow:none}.tblwrap{display:none}.mobile-list{display:grid;gap:7px;padding:0 10px 10px}.mobile-row{border:1px solid var(--line);border-radius:2px;padding:12px;background:var(--surface-2)}.mobile-top,.mobile-bottom{display:flex;justify-content:space-between;gap:12px;align-items:center}.mobile-top{margin-bottom:9px}.mobile-name{color:var(--muted);font-size:12px;margin-left:5px}.mobile-price{font-weight:800}.mobile-change{font-size:12px;font-weight:750;margin-left:5px}.mobile-rsi{font-weight:800}.mobile-meta{color:var(--muted);font-size:11px;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.toolbar{padding:15px 12px 12px}.toolbar h2{font-size:17px}.chip{padding:6px 8px}.detail-stats{grid-template-columns:repeat(2,1fr)}.panel{padding:18px 15px}.foot{font-size:11px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation-duration:.01ms!important;animation-delay:0ms!important}}
/* ——— Telegram 动效移植（参数实测自 Telegram-iOS 开源源码）———
   弹簧: 菜单 d=104(2.1%过冲)→--ease-pop；Alert/小元素 d=88(6.5%过冲)→--ease-bounce；
   招牌布局曲线(0.38,.7,.125,1)→--ease-tg；按压: 按下瞬时着色、松开0.2s淡出(HighlightableButton)；收起永远比出现快 */
@keyframes tg-in{from{opacity:0;transform:translateY(8px)}}
@keyframes tg-fade{from{opacity:0}}
@keyframes tg-panel{from{opacity:0;transform:scale(.88)}}
.kpi{animation:tg-in .4s var(--ease-tg) both}
.kpi:nth-child(2){animation-delay:.04s}.kpi:nth-child(3){animation-delay:.08s}.kpi:nth-child(4){animation-delay:.12s}.kpi:nth-child(5){animation-delay:.16s}.kpi:nth-child(6){animation-delay:.2s}
.signal-grid{animation:tg-in .4s var(--ease-tg) .1s both}
.watch-panel{animation:tg-in .4s var(--ease-tg) .16s both}
#detail.on{animation:tg-fade .25s ease}
#detail.on .panel{animation:tg-panel .5s var(--ease-bounce)}
.table tbody tr{transition:background .2s cubic-bezier(0,0,.2,1)}
tbody tr:active{background:var(--hl);transition:none}
.chip:active,.copy-btn:active,.charttab:active,.close-x:active,.watch-card:active,.row-button:active .mobile-row{transform:scale(.97);transition:none}
.chip,.copy-btn,.charttab,.close-x,.watch-card,.mobile-row{transition-property:background,border-color,color,transform,box-shadow;transition-duration:.2s;transition-timing-function:cubic-bezier(0,0,.2,1)}
.app-cta:active{transform:scale(.97);filter:brightness(.94);transition:none}
svg{width:100%;height:auto;display:block}
</style></head><body>
<main class="wrap">
<header class="topbar"><div class="brandrow"><img class="brand-mark" src="../assets/pwa/icon-192.png" alt="" aria-hidden="true"><div><div class="eyebrow">Market pulse / daily close</div><h1>Meridian <span>${meta.marketDate} 收盘</span></h1><div class="subtitle">SP500 实时市值前 ${meta.topN} + SPMO · 生成于 ${meta.generatedAtLocal}</div></div></div><div class="header-meta"><div class="status" id="status"></div><div>数据源：东财 ${meta.srcEast} · Yahoo ${meta.srcYahoo ?? 0} · 腾讯兜底 ${meta.srcTx} · 失败 ${meta.srcFail}</div><a class="app-cta" href="../app/us-stock-monitor.apk" download title="安装到手机桌面，数据随网站自动更新，无需重装"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7.5" y="3" width="9" height="18" rx="2.5"/><path d="M12 7.5V14"/><path d="M10 12l2 2 2-2"/><path d="M10.5 18.5h3"/></svg>下载安卓 App<small>数据同步更新</small></a></div></header>
<section class="kpis" id="kpis" aria-label="市场摘要"><div class="boot">正在载入收盘数据…</div></section>
<section class="signal-grid"><article class="hero" id="hero"></article><aside class="method"><div class="section-kicker">Method</div><h2>指标口径</h2><div class="method-row"><span>RSI6</span><b>Wilder RMA · &gt;${cfg.rsi.overbought} / &lt;${cfg.rsi.oversold}</b></div><div class="method-row"><span>Vegas 通道</span><b>${cfg.tunnels.map((t) => 'EMA' + t.n.join('/')).join(' · ')}</b></div><div class="method-row"><span>观察周期</span><b>日线收盘 · ${meta.marketDate}</b></div><div class="method-alert">页面只呈现收盘数据和信号事实，不构成投资建议。数据来自第三方公开接口。</div></aside></section>
<section class="data-panel watch-panel" id="watch-panel" aria-label="自选持仓"><div class="toolbar"><div><div class="section-kicker">My positions</div><h2>自选持仓 <span id="watch-count" class="mut" style="font-size:14px;font-weight:650"></span></h2><div class="toolbar-note">config.watchlist ＋ 本机页内增删（存浏览器，点★切换）· 池内标的同时参与下方全表排名</div></div><div class="tool-right"><button id="copy-cfg" class="copy-btn" type="button" title="把当前自选清单复制为 JSON 片段——公开清单粘贴进 config.json，真实持仓粘贴进 config.local.json（gitignore 不上传）">复制清单 → config</button></div></div><div class="watch-grid" id="watch-grid"></div></section>
<section class="data-panel"><div class="toolbar"><div><div class="section-kicker">Watchlist</div><h2>监控标的</h2><div class="toolbar-note" id="toolbar-note"></div></div><div class="tool-right"><span class="charttabs" id="rswitch" role="group" aria-label="RSI 周期切换"><button class="charttab on" type="button" data-p="6">RSI6</button><button class="charttab" type="button" data-p="14">RSI14</button></span><div class="searchbox"><input id="search" type="search" placeholder="搜索代码 / 名称（如 NVDA、英伟达）" aria-label="搜索监控标的" autocomplete="off"><div class="add-sug" id="add-sug" hidden></div></div><div class="chips" id="chips" role="group" aria-label="筛选监控标的"></div></div></div><div class="tblwrap"><table class="table" id="tbl"><thead><tr><th class="stcol" aria-label="自选开关"></th><th>排名</th><th>代码</th><th>名称</th><th>收盘</th><th>涨跌</th><th id="th-rsi">RSI6（日/周）</th><th id="th-wkrsi">Vegas 通道（日/周）</th><th>信号</th><th>SPMO%</th></tr></thead><tbody></tbody></table></div><div class="mobile-list" id="mobile-list"></div></section>
<footer class="foot"><strong>口径：</strong>RSI6 = Wilder 平滑（同通达信/TradingView RMA）· EMA 种子 = 前 n 项 SMA · Vegas 三通道：短 EMA144/169 · 中 EMA288/338 · 长 EMA576/676 · 周线 = 日线按周重采样（周五标签）后同参重算（周线长通道 EMA576/676 需约 13 年历史，多数标的如实标数据不足）。<br>指标只描述事实和常用读法，不构成投资建议。<div style="margin-top:11px"><a class="status-pill" style="text-decoration:none;color:var(--ink)" href="../app/us-stock-monitor.apk" download><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:15px;height:15px;margin-right:2px"><rect x="7.5" y="3" width="9" height="18" rx="2.5"/><path d="M12 7.5V14"/><path d="M10 12l2 2 2-2"/><path d="M10.5 18.5h3"/></svg>安卓 App 下载</a><span style="margin-left:8px">安装到手机桌面，数据随网站自动更新</span></div></footer>
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
/* 自选状态机：config 的服务端标 r.cfgW ＋ 本机 localStorage 叠加层（removed=取消的池内 / added=新增的池外）。
 * 页内增删只存本机浏览器；「复制清单」导出 config 片段，写回 config.json 后全设备生效。 */
const WKEY='usmon.watch.v1',qGot={};
let wstate={added:[],removed:[]};
try{const s=JSON.parse(localStorage.getItem(WKEY)||'{}');if(Array.isArray(s.added))wstate.added=s.added.map(x=>String(x).toUpperCase()).filter(x=>/^[A-Z]{1,6}$/.test(x)).slice(0,12);if(Array.isArray(s.removed))wstate.removed=s.removed.map(x=>String(x).toUpperCase())}catch(e){}
const saveW=()=>{try{localStorage.setItem(WKEY,JSON.stringify(wstate))}catch(e){}};
allRows.forEach(r=>{r.cfgW=!!r.watch});
const isWatch=r=>r.cfgW?!wstate.removed.includes(r.ticker):wstate.added.includes(r.ticker);
const watchRows=()=>allRows.filter(isWatch);
const extraAdds=()=>wstate.added.filter(t=>!byT[t]);
const watchTotal=()=>watchRows().length+extraAdds().length;
function toggleWatch(t){t=String(t).toUpperCase();const r=byT[t];
 if(r&&r.cfgW){const i=wstate.removed.indexOf(t);if(i>=0)wstate.removed.splice(i,1);else wstate.removed.push(t)}
 else{const i=wstate.added.indexOf(t);if(i>=0)wstate.added.splice(i,1);else if(wstate.added.length<12){wstate.added.push(t);fetchExtra(t)}}
 saveW();renderAll()}
/* 池外新增标的的在线报价：qt.gtimg.cn 返回 JS 变量赋值，script 注入跨域可读（页面其余部分仍零外网请求） */
function liveQuote(t){return new Promise(res=>{let done=false;const s=document.createElement('script');
 const fin=v=>{if(done)return;done=true;clearTimeout(to);try{s.remove()}catch(e){}res(v)};
 const to=setTimeout(()=>fin(null),6000);
 s.onload=()=>{let v=null;try{v=window['v_us'+t]||null}catch(e){}fin(v&&typeof v==='string'&&v.length>10?v:null)};
 s.onerror=()=>fin(null);s.src='https://qt.gtimg.cn/q=us'+t;document.head.appendChild(s)})}
function fetchExtra(t){if(qGot[t])return;qGot[t]=1;liveQuote(t).then(v=>{const e=document.getElementById('q-'+t);if(!e)return;
 if(!v){e.textContent='报价未取到（离线或代码无效）';return}
 const f=v.split('~'),price=parseFloat(f[3]),prev=parseFloat(f[4]);let nm=(f[1]||'').trim();if(nm.indexOf('\ufffd')>=0)nm='';
 const chg=prev>0&&Number.isFinite(price)?(price/prev-1)*100:null;
 e.textContent=(nm?nm+' · ':'')+(Number.isFinite(price)?price.toFixed(2):'--')+(chg!==null?' '+(chg>=0?'+':'')+chg.toFixed(2)+'%':'');
 e.className='wc-price'+(chg===null?'':chg>=0?' up':' dn')})}
const groups={all:{label:'全部',count:allRows.length},watch:{label:'自选',count:watchTotal()},ob:{label:'超买',count:D.groups.overbought.length},os:{label:'超卖',count:D.groups.oversold.length},obr:{label:'超买回落',count:(D.groups.obReturn||[]).length},osr:{label:'超卖回升',count:(D.groups.osReturn||[]).length},ev:{label:'通道事件',count:D.groups.events.length},wob:{label:'周超买',count:allRows.filter(r=>r.wk&&r.wk.rsi6&&r.wk.rsi6.state==='overbought').length},wos:{label:'周超卖',count:allRows.filter(r=>r.wk&&r.wk.rsi6&&r.wk.rsi6.state==='oversold').length},wret:{label:'周回归',count:allRows.filter(r=>r.wk&&r.wk.rsi6&&(r.wk.rsi6.cross==='out_ob'||r.wk.rsi6.cross==='out_os')).length},spmo:{label:'SPMO重合',count:D.rows.filter(r=>r.spmoPct!=null).length}};
/* RSI 周期切换：主口径（JSON groups/推送）仍是 RSI6；页内可切 14 查看同一套
 * 超买/超卖/回归信号。选择存本机浏览器，旧行缺 rsi14 时自动回落 RSI6。 */
let rsiP='6';try{const v=localStorage.getItem('usmon.rsi.v1');if(v==='6'||v==='14')rsiP=v}catch(e){}
const dR=r=>rsiP==='14'&&r.rsi14?r.rsi14:r.rsi6;
const wR=r=>{const w=r.wk;if(!w)return null;return rsiP==='14'&&w.rsi14?w.rsi14:w.rsi6};
function rsiCounts(){const ob=allRows.filter(r=>{const x=dR(r);return x&&x.state==='overbought'}).length,os=allRows.filter(r=>{const x=dR(r);return x&&x.state==='oversold'}).length,obr=allRows.filter(r=>{const x=dR(r);return x&&x.cross==='out_ob'}).length,osr=allRows.filter(r=>{const x=dR(r);return x&&x.cross==='out_os'}).length,wob=allRows.filter(r=>{const x=wR(r);return x&&x.state==='overbought'}).length,wos=allRows.filter(r=>{const x=wR(r);return x&&x.state==='oversold'}).length,wret=allRows.filter(r=>{const x=wR(r);return x&&(x.cross==='out_ob'||x.cross==='out_os')}).length;return{ob,os,obr,osr,wob,wos,wret}}
let cur='all',lastFocus=null;
const status=document.getElementById('status'),statusItems=[];if(D.meta.srcEast)statusItems.push('<span class="status-pill"><i></i>东财 '+D.meta.srcEast+' 只</span>');if(D.meta.srcYahoo)statusItems.push('<span class="status-pill"><i></i>Yahoo '+D.meta.srcYahoo+' 只</span>');if(D.meta.srcTx)statusItems.push('<span class="status-pill alert"><i></i>腾讯兜底 '+D.meta.srcTx+' 只</span>');if(D.meta.srcFail)statusItems.push('<span class="status-pill alert"><i></i>失败 '+D.meta.srcFail+' 只</span>');status.innerHTML=statusItems.join('');
const kpis=document.getElementById('kpis');const kpiDefs=[['监控标的',allRows.length,'SPMO + 股票池'],['超买',D.groups.overbought.length,'RSI 超过 '+D.cfg.rsi.overbought],['超卖',D.groups.oversold.length,'RSI 低于 '+D.cfg.rsi.oversold],['通道事件',D.groups.events.length,'上下穿越 Vegas 通道'],['SPMO 重合',groups.spmo.count,'SPMO 持仓快照'],['自选持仓',watchTotal(),'自选 + 持仓清单（页内可增删）']];kpiDefs.forEach(x=>{const el=document.createElement('div');el.className='kpi';el.innerHTML='<div class="kpi-label">'+x[0]+'</div><div class="kpi-value"'+(x[0]==='自选持仓'?' id="kpi-watch"':'')+(x[0]==='超买'?' id="kpi-ob"':'')+(x[0]==='超卖'?' id="kpi-os"':'')+'>'+x[1]+'</div><div class="kpi-note">'+x[2]+'</div>';kpis.appendChild(el)});
function tunnelHtml(t){if(!t||!t.pos)return '<span class="tunnel"><b>'+((t&&t.key)||'通道')+'</b><span class="mut">数据不足</span></span>';return '<span class="tunnel"><b>'+esc(t.key)+'</b><span class="'+(t.pos==='above'?'up':t.pos==='below'?'dn':'mut')+'">'+POS[t.pos]+(t.event&&t.event.startsWith('break')?' · 穿越':'')+'</span></span>'}
function renderHero(){const h=document.getElementById('hero'),s=D.spmo;if(!s){h.className='hero empty';h.innerHTML='<div><div class="section-kicker">Core position</div><div class="hero-title">SPMO 今日暂无收盘数据</div><p class="mut">核心标的没有进入本次报告，股票池和筛选结果仍可正常查看。</p></div>';return}const sx=dR(s);const state=sx&&sx.state,stateText=state==='overbought'?'超买':state==='oversold'?'超卖':'中性';h.innerHTML='<div class="hero-head"><div><div class="section-kicker">Core position · SPMO</div><div class="hero-title">'+esc(s.name||'标普500动量ETF')+'</div></div><span class="signal-badge">'+stateText+'</span></div><div class="hero-grid"><div><div class="hero-price">'+num(s.close)+' <span class="change '+(s.chgPct>=0?'up':'dn')+'">'+pct(s.chgPct)+'</span></div><div class="mut">截至 '+esc(s.asOf||D.meta.marketDate)+' 收盘 · '+esc(s.source||'--')+'</div></div><div><div class="metric-label">RSI'+rsiP+'</div><div class="rsi-value '+(state==='overbought'?'up':state==='oversold'?'dn':'')+'">'+num(sx?sx.value:null,1)+'</div><div class="tunnel-list">'+(s.tunnels||[]).map(tunnelHtml).join('')+'</div></div></div><div class="hero-notes">'+(s.notes||[]).map(n=>esc(n.text)).join(' ')+'</div>'}
renderHero();
/* 自选持仓面板：config 清单 ± 本机增删后重渲染；池外新增标的先给在线报价卡 */
function renderWatchPanel(){const wp=document.getElementById('watch-panel'),grid=document.getElementById('watch-grid');if(!wp)return;
 const rows=watchRows(),extra=extraAdds();
 if(!rows.length&&!extra.length){wp.style.display='none';return}
 wp.style.display='';document.getElementById('watch-count').textContent='（'+(rows.length+extra.length)+'）';grid.innerHTML='';
 const star=(title)=>{const st=document.createElement('span');st.className='star cardstar';st.setAttribute('role','button');st.setAttribute('tabindex','0');st.title=title;st.textContent='★';return st};
 rows.forEach(r=>{const b=document.createElement('button');b.type='button';b.className='watch-card';b.setAttribute('aria-label','查看 '+esc(r.ticker)+' 详情');
  b.innerHTML='<div class="wc-top"><span class="ticker">'+esc(r.ticker)+'</span>'+(r.note?'<span class="badge note-badge" title="'+esc(r.note)+'">'+esc(r.note)+'</span>':'<span class="badge note-badge">自选</span>')+'<span class="wc-price">'+num(r.close)+' <span class="'+(r.chgPct>=0?'up':'dn')+'">'+pct(r.chgPct)+'</span></span></div><div class="wc-sub"><span class="company">'+esc(r.name)+'</span><span class="signal-badge">'+stateText(r)+'</span></div><div class="tunnel-list">'+(r.tunnels||[]).map(tunnelHtml).join('')+'</div><div class="wc-foot mut">RSI'+rsiP+' '+num(dR(r)?dR(r).value:null,1)+' · '+(sigTags(r)||'无信号')+'</div>';
  const st=star('移出自选');st.setAttribute('aria-label','移出自选');
  st.onclick=e=>{e.stopPropagation();toggleWatch(r.ticker)};st.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();toggleWatch(r.ticker)}};
  b.querySelector('.wc-top').insertBefore(st,b.querySelector('.wc-price'));
  b.onclick=()=>openRow(r.ticker,b);grid.appendChild(b)});
 extra.forEach(t=>{const d=document.createElement('div');d.className='watch-card pending';
  d.innerHTML='<div class="wc-top"><span class="ticker">'+esc(t)+'</span><span class="badge note-badge">自选</span><span class="wc-price mut" id="q-'+t+'">获取报价…</span></div><div class="wc-sub"><span class="company mut">监控池外 · 完整指标待写进 config 后纳入</span></div><div class="wc-foot mut"><a href="https://www.tradingview.com/chart/?symbol='+encodeURIComponent(t)+'" target="_blank" rel="noopener">TradingView 打开 ↗</a></div>';
  const st=star('移出自选');st.setAttribute('aria-label','移出自选');
  st.onclick=e=>{e.stopPropagation();toggleWatch(t)};st.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();toggleWatch(t)}};
  d.querySelector('.wc-top').insertBefore(st,d.querySelector('.wc-price'));
  grid.appendChild(d);fetchExtra(t)})}
const chips=document.getElementById('chips'),chipEls={};Object.entries(groups).forEach(([k,v])=>{const el=document.createElement('button');el.type='button';el.className='chip'+(k===cur?' on':'');el.setAttribute('aria-pressed',k===cur?'true':'false');el.innerHTML=v.label+' <b>'+v.count+'</b>';el.onclick=()=>{cur=k;document.querySelectorAll('.chip').forEach(c=>{c.classList.remove('on');c.setAttribute('aria-pressed','false')});el.classList.add('on');el.setAttribute('aria-pressed','true');render()};chipEls[k]=el;chips.appendChild(el)});
function inGroup(r){if(cur==='all')return true;if(cur==='watch')return isWatch(r);if(cur==='spmo')return r.spmoPct!=null;if(cur==='ob'){const x=dR(r);return !!(x&&x.state==='overbought')}if(cur==='os'){const x=dR(r);return !!(x&&x.state==='oversold')}if(cur==='obr'){const x=dR(r);return !!(x&&x.cross==='out_ob')}if(cur==='osr'){const x=dR(r);return !!(x&&x.cross==='out_os')}if(cur==='wob'){const x=wR(r);return !!(x&&x.state==='overbought')}if(cur==='wos'){const x=wR(r);return !!(x&&x.state==='oversold')}if(cur==='wret'){const x=wR(r);return !!(x&&(x.cross==='out_ob'||x.cross==='out_os'))}return D.groups.events.includes(r.ticker)}
let q='';const matchQ=r=>{if(!q)return true;const s=q.toLowerCase();return r.ticker.toLowerCase().includes(s)||(r.name||'').toLowerCase().includes(s)||(r.note||'').toLowerCase().includes(s)};
function posCell(t){if(!t||!t.pos)return '<span class="mut">--</span>';const ev=t.event&&t.event.startsWith('break');return '<span class="'+(t.pos==='above'?'up':t.pos==='below'?'dn':'mut')+'">'+POS[t.pos]+(ev?' ↑↑':'')+'</span>'}
function evTxt(r){const a=[];const x=dR(r);if(x&&x.cross)a.push({into_ob:'新进超买',into_os:'新进超卖',out_ob:'超买回落',out_os:'超卖回升'}[x.cross]);(r.tunnels||[]).forEach(t=>{if(t.event&&t.event.startsWith('break'))a.push((t.event==='break_up'?'上穿':'下穿')+t.key)});const w=wR(r);if(w&&w.cross)a.push({into_ob:'周新进超买',into_os:'周新进超卖',out_ob:'周超买回落',out_os:'周超卖回升'}[w.cross]);((r.wk&&r.wk.tunnels)||[]).forEach(t=>{if(t.event&&t.event.startsWith('break'))a.push((t.event==='break_up'?'周上穿':'周下穿')+t.key)});return a.join('、')}
/* 信号标签：日/周 RSI 状态与回归、通道上下穿全部做成表格内彩色小标签——一目了然，不用点。
 * 实心=当前停在区内（红=超买 绿=超卖）；描边=今日/本周事件（回落/回升）；描边加粗=通道穿越。 */
function tagx(x,cls,title){return '<span class="tagx '+cls+'"'+(title?' title="'+esc(title)+'"':'')+'>'+x+'</span>'}
function sigTags(r){const a=[];const x=dR(r);
if(x){if(x.state==='overbought')a.push(tagx('日超买','fill-up','RSI'+rsiP+'='+(x.value!=null?x.value.toFixed(1):'')+(x.cross==='into_ob'?' · 新进':'')));
else if(x.state==='oversold')a.push(tagx('日超卖','fill-dn','RSI'+rsiP+'='+(x.value!=null?x.value.toFixed(1):'')+(x.cross==='into_os'?' · 新进':'')));
if(x.cross==='out_ob')a.push(tagx('日超买回落','o-up','前值 '+(x.prev!=null?x.prev.toFixed(1):'')+' → '+(x.value!=null?x.value.toFixed(1):'')+'，做T回补观察'));
if(x.cross==='out_os')a.push(tagx('日超卖回升','o-dn','前值 '+(x.prev!=null?x.prev.toFixed(1):'')+' → '+(x.value!=null?x.value.toFixed(1):'')+'，吸纳确认观察'));}
const w=wR(r);
if(w){if(w.state==='overbought')a.push(tagx('周超买','fill-up','周RSI'+rsiP+'='+(w.value!=null?w.value.toFixed(1):'')));
else if(w.state==='oversold')a.push(tagx('周超卖','fill-dn','周RSI'+rsiP+'='+(w.value!=null?w.value.toFixed(1):'')));
if(w.cross==='out_ob')a.push(tagx('周超买回落','o-up','周线回归，做T回补观察'));
if(w.cross==='out_os')a.push(tagx('周超卖回升','o-dn','周线回归，吸纳确认观察'));}
(r.tunnels||[]).forEach(t=>{if(t.event==='break_up')a.push(tagx('上穿'+t.key,'acc','收盘上穿'+t.key));if(t.event==='break_down')a.push(tagx('下穿'+t.key,'o-dn','收盘下穿'+t.key))});
((r.wk&&r.wk.tunnels)||[]).forEach(t=>{if(t&&t.event==='break_up')a.push(tagx('周上穿'+t.key,'acc','周线收盘上穿'+t.key));if(t&&t.event==='break_down')a.push(tagx('周下穿'+t.key,'o-dn','周线收盘下穿'+t.key))});
return a.join('')}
function stateText(r){const x=dR(r);return x&&x.state!=='neutral'?(x.state==='overbought'?'超买':'超卖'):'中性'}
function wkStateTxt(r){const w=wR(r);return !w?'':w.state==='overbought'?'超买':w.state==='oversold'?'超卖':'中性'}
/* 通道/RSI 合并单元：两行（日/周），每通道直接标「短上/中内/长—」，客观可读不靠图例；穿越加下划线 */
function tunLine(tunnels){const C={above:'上',inside:'内',below:'下'},S={短通道:'短',主通道:'中',长通道:'长'};
 return (tunnels||[]).map((t,i)=>{const lab=t&&S[t.key]?S[t.key]:'T'+(i+1);
  if(!t||!t.pos)return '<span class="tp na" title="'+esc((t&&t.key)||('通道'+(i+1)))+' 数据不足"><i>'+lab+'</i>—</span>';
  const c=t.pos==='above'?'up':t.pos==='below'?'dn':'ins';
  return '<span class="tp '+c+(t.event&&t.event.startsWith('break')?' ev':'')+'" title="'+esc(t.key)+' '+POS[t.pos]+(t.event&&t.event.startsWith('break')?' · 穿越':'')+'"><i>'+lab+'</i>'+C[t.pos]+'</span>'}).join('')}
function tunDualCell(r){return '<div class="tunrow"><span class="tf">日</span>'+tunLine(r.tunnels)+'</div>'+(r.wk?'<div class="tunrow"><span class="tf">周</span>'+tunLine(r.wk.tunnels)+'</div>':'')}
function rsiDualCell(r){const x=dR(r),w=wR(r);return '<div class="tunrow"><span class="tf">日</span><b class="'+(x&&x.state==='overbought'?'up':x&&x.state==='oversold'?'dn':'')+'">'+num(x?x.value:null,1)+'</b></div>'+(w?'<div class="tunrow"><span class="tf">周</span><b class="'+(w.state==='overbought'?'up':w.state==='oversold'?'dn':'')+'">'+num(w.value,1)+'</b></div>':'')}
function idxTxt(r){const a=[];if(r.sp500)a.push('标普500');if(r.ndx)a.push('纳指100');return a.join(' · ')}
/* K 线：TradingView 开源库 lightweight-charts 本地渲染（内联进本页，零外网请求，墙内/离线可用）。
 * 蜡烛 = 我们的复权日K（后复权锚定现价）；六条 EMA 由服务端对全量历史算好切片传入。
 * 主题跟随系统深浅色；红涨绿跌与表格一致。图表库缺失时盒子留文字说明。 */
let kInst=null,kResize=null,kMode='d',KLcache=null,kSeq=0;
function klines(){return KLcache?Promise.resolve(KLcache):fetch('klines.json').then(res=>{if(!res.ok)throw new Error('HTTP '+res.status);return res.json()}).then(j=>{KLcache=j;return j})}
async function drawK(r,mode){const box=document.getElementById('tv-box');if(!box)return;if(mode)kMode=mode;
if(kInst){try{kInst.remove()}catch{}kInst=null}if(kResize){window.removeEventListener('resize',kResize);kResize=null}
if(!window.LightweightCharts){box.innerHTML='<div style="height:100%;display:grid;place-items:center;font-size:13px" class="mut">K 线库未加载（仅影响图表，不影响数据）</div>';return}
const my=++kSeq;box.innerHTML='<div style="height:100%;display:grid;place-items:center;font-size:13px" class="mut">K 线载入中…</div>';
let src=null;
try{const kl=await klines();if(my!==kSeq)return;const k=kl[r.ticker];src=kMode==='w'?(k&&k.wk):k;}
catch(e){if(my!==kSeq)return;box.innerHTML='<div style="height:100%;display:grid;place-items:center;font-size:13px" class="mut">K 线数据加载失败（离线或首次部署未完成），稍后重开详情重试</div>';return}
if(my!==kSeq)return;
if(!src||!src.c||!src.c.length){box.innerHTML='<div style="height:100%;display:grid;place-items:center;font-size:13px" class="mut">'+(kMode==='w'?'周线K线数据不足':'K线数据不足')+'</div>';return}
box.innerHTML='';
const dark=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches;
const grid=dark?'#24333a':'#e7edef',textC=dark?'#9aadb1':'#708087';
const chart=LightweightCharts.createChart(box,{height:400,layout:{background:{type:'solid',color:'transparent'},textColor:textC,fontSize:11},grid:{vertLines:{color:grid},horzLines:{color:grid}},rightPriceScale:{borderColor:grid},timeScale:{borderColor:grid},crosshair:{mode:0}});
kInst=chart;
const candles=chart.addCandlestickSeries({upColor:'#c04b43',downColor:'#16815f',borderVisible:false,wickUpColor:'#c04b43',wickDownColor:'#16815f'});
candles.setData(src.d.map((d,i)=>({time:d,open:src.o[i],high:src.h[i],low:src.l[i],close:src.c[i]})));
const emaCfg=[['#e69138','EMA144',0,1.5],['#e69138','EMA169',1,1.5],['#8e7cc3','EMA288',2,1],['#8e7cc3','EMA338',3,1],['#3d85c6','EMA576',4,1],['#3d85c6','EMA676',5,1]];
emaCfg.forEach(([col,,idx,w])=>{const pts=src.d.map((d,i)=>({time:d,value:src.e[idx][i]})).filter(p=>p.value!=null);if(pts.length)chart.addLineSeries({color:col,lineWidth:w,priceLineVisible:false,lastValueVisible:false}).setData(pts)});
chart.timeScale().fitContent();
kResize=()=>{try{chart.applyOptions({width:box.clientWidth})}catch{}};kResize();window.addEventListener('resize',kResize)}
function openRow(tk,button){lastFocus=button||document.activeElement;show(tk)}
function render(){const bt=document.querySelector('#kpis .boot');if(bt)bt.remove();const visible=allRows.filter(r=>inGroup(r)&&matchQ(r)),tb=document.querySelector('#tbl tbody'),ml=document.getElementById('mobile-list');tb.innerHTML='';ml.innerHTML='';document.getElementById('toolbar-note').textContent='当前显示 '+visible.length+' 只'+(q?' · 搜索"'+q+'"':'')+' · 点★增删自选 · 点行看口径与K线';if(!visible.length){tb.innerHTML='<tr><td class="table-empty" colspan="10">当前筛选没有匹配标的</td></tr>';ml.innerHTML='<div class="table-empty" colspan="10">当前筛选没有匹配标的</div>';return}visible.forEach(r=>{const w=isWatch(r);const dx=dR(r);const st=sigTags(r)||('<span class="signal-badge">'+stateText(r)+'</span>');const tr=document.createElement('tr');tr.className=dx&&dx.state==='overbought'?'ob':dx&&dx.state==='oversold'?'os':'';tr.tabIndex=0;tr.setAttribute('role','button');tr.setAttribute('aria-label',r.ticker+' '+r.name+' 详情');tr.innerHTML='<td class="stcol"><button class="star'+(w?'':' off')+'" type="button" aria-label="'+(w?'移出':'加入')+'自选" title="加入/移出自选">'+(w?'★':'☆')+'</button></td><td class="rank">'+(r.rank??'★')+'</td><td><span class="ticker">'+esc(r.ticker)+'</span>'+(isWatch(r)?'<span class="badge note-badge">自选</span>':'')+'</td><td><span class="company"'+(r.note?' title="'+esc(r.note)+'"':'')+'>'+esc(r.name)+'</span>'+(r.ndx?' <span class="badge idx-badge">纳指100</span>':'')+(!r.rank&&r.sp500?' <span class="badge note-badge">标普500</span>':'')+(r.adj==='raw'?' <span class="warn badge">不复权</span>':'')+'</td><td>'+num(r.close)+'</td><td class="'+(r.chgPct>=0?'up':'dn')+'">'+pct(r.chgPct)+'</td><td class="rsi">'+rsiDualCell(r)+'</td><td>'+tunDualCell(r)+'</td><td class="sig">'+st+'</td><td>'+(r.spmoPct!=null?r.spmoPct.toFixed(1)+'%':'--')+'</td></tr>';tr.querySelector('button.star').onclick=e=>{e.stopPropagation();toggleWatch(r.ticker)};tr.onclick=()=>openRow(r.ticker,tr);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openRow(r.ticker,tr)}};tb.appendChild(tr);const w2=isWatch(r);const card=document.createElement('div');card.className='mobile-row';card.innerHTML='<button class="row-button" type="button" aria-label="查看 '+esc(r.ticker)+' 详情"><div class="mobile-top"><div><span class="ticker">'+esc(r.ticker)+'</span>'+(w2?'<span class="badge note-badge">自选</span>':'')+(r.ndx?'<span class="badge idx-badge">纳指100</span>':'')+'<span class="mobile-name">'+esc(r.name)+'</span></div><div class="mobile-price"><span class="star'+(w2?'':' off')+' mstar" role="button" tabindex="0" aria-label="加入/移出自选">'+(w2?'★':'☆')+'</span> '+num(r.close)+' <span class="mobile-change '+(r.chgPct>=0?'up':'dn')+'">'+pct(r.chgPct)+'</span></div></div><div class="mobile-bottom">'+(sigTags(r)||('<span class="signal-badge">'+stateText(r)+'</span>'))+'<span class="mobile-rsi">RSI'+rsiP+' '+num(dx?dx.value:null,1)+'</span><span class="mut">'+(r.spmoPct!=null?'SPMO '+r.spmoPct.toFixed(1)+'%':'#'+(r.rank??'SPMO'))+'</span></div><div class="mobile-meta">短 '+(r.tunnels?.[0]?.pos?POS[r.tunnels[0].pos]:'--')+' · 中 '+(r.tunnels?.[1]?.pos?POS[r.tunnels[1].pos]:'--')+' · 长 '+(r.tunnels?.[2]?.pos?POS[r.tunnels[2].pos]:'--')+(wR(r)?' · 周RSI'+rsiP+' '+num(wR(r).value,1):'')+(r.note?' · '+esc(r.note):'')+'</div></button>';const ms=card.querySelector('.mstar');if(ms){ms.onclick=e=>{e.stopPropagation();toggleWatch(r.ticker)};ms.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();toggleWatch(r.ticker)}}}card.querySelector('button').onclick=()=>openRow(r.ticker,card.querySelector('button'));ml.appendChild(card)})}
function show(tk){const r=byT[tk];if(!r)return;const detail=document.getElementById('detail'),p=document.getElementById('panel'),state=stateText(r),w=isWatch(r);p.innerHTML='<div class="panel-head"><div><div class="section-kicker">Instrument detail</div><h3 id="detail-title">'+esc(r.ticker)+' · '+esc(r.name)+'</h3><div class="meta">'+(r.rank?'市值排名 #'+r.rank+' · ':'')+'截至 '+esc(r.asOf||D.meta.marketDate)+' 收盘</div></div><div class="headbtns"><button class="star'+(w?'':' off')+'" id="detail-star" type="button" aria-label="加入/移出自选" title="加入/移出自选">'+(w?'★':'☆')+'</button><button class="close-x" id="detail-close" type="button" aria-label="关闭详情">×</button></div></div><div class="detail-stats"><div class="detail-stat"><span class="metric-label">收盘</span><b>'+num(r.close)+'</b></div><div class="detail-stat"><span class="metric-label">涨跌</span><b class="'+(r.chgPct>=0?'up':'dn')+'">'+pct(r.chgPct)+'</b></div><div class="detail-stat"><span class="metric-label">RSI'+rsiP+'</span><b class="'+(state==='超买'?'up':state==='超卖'?'dn':'')+'">'+num(dR(r)?dR(r).value:null,1)+' · '+state+'</b></div></div><div class="method-row"><span>数据口径</span><b>'+esc(r.source||'--')+' · '+(r.adj==='hfq'?'后复权':'不复权')+' · '+(r.bars||'--')+' 根</b></div><div class="method-row"><span>Vegas 通道</span><b>'+((r.tunnels||[]).map(t=>esc(t.key)+' '+(t.pos?POS[t.pos]:'数据不足')).join(' · ')||'--')+'</b></div>'+(r.spmoPct!=null?'<div class="method-row"><span>SPMO 持仓</span><b>'+r.spmoPct.toFixed(2)+'%</b></div>':'')+(r.note?'<div class="method-row"><span>自选备注</span><b>'+esc(r.note)+'</b></div>':'')+(idxTxt(r)?'<div class="method-row"><span>成分指数</span><b>'+idxTxt(r)+(r.rank!=null?'（池内）':'（池外）')+'</b></div>':'')+(r.wk?'<div class="method-row"><span>周线RSI'+rsiP+'</span><b class="'+(wR(r)&&wR(r).state==='overbought'?'up':wR(r)&&wR(r).state==='oversold'?'dn':'')+'">'+(wR(r)?num(wR(r).value,1)+' · '+wkStateTxt(r):'数据不足')+'</b></div><div class="method-row"><span>周线通道</span><b>'+((r.wk.tunnels||[]).map(t=>esc(t.key)+' '+(t.pos?POS[t.pos]:'数据不足')).join(' · ')||'--')+'</b></div><div class="method-row"><span>周线截至</span><b>'+esc(r.wk.asOf)+' · '+r.wk.bars+' 周</b></div>':'')+'<div class="notes">'+(r.notes||[]).map(n=>'<div>['+esc(n.tag)+'] '+esc(n.text)+'</div>').join('')+'</div><div class="tvcap">K 线 · lightweight-charts 本地渲染（零外网请求，离线可用；橙=短144/169 · 紫=中288/338 · 蓝=长576/676）· <span class="charttabs"><button class="charttab on" id="ct-d" type="button">日线</button><button class="charttab" id="ct-w" type="button">周线</button></span> · <a href="https://www.tradingview.com/chart/?symbol='+encodeURIComponent(r.tvSymbol||r.ticker)+'" target="_blank" rel="noopener">TradingView 打开 ↗</a></div><div class="tvbox" id="tv-box"></div>';detail.classList.add('on');drawK(r,'d');document.getElementById('detail-close').focus();document.getElementById('detail-close').onclick=closeDetail;const ds=document.getElementById('detail-star');ds.onclick=()=>{toggleWatch(r.ticker);const nw=isWatch(byT[r.ticker]);ds.textContent=nw?'★':'☆';ds.classList.toggle('off',!nw)};const cd=document.getElementById('ct-d'),cw=document.getElementById('ct-w');cd.onclick=()=>{cd.classList.add('on');cw.classList.remove('on');drawK(r,'d')};cw.onclick=()=>{cw.classList.add('on');cd.classList.remove('on');drawK(r,'w')}}
function closeDetail(){document.getElementById('detail').classList.remove('on');if(lastFocus&&lastFocus.focus)lastFocus.focus()}
document.getElementById('detail').onclick=e=>{if(e.target.id==='detail')closeDetail()};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('detail').classList.contains('on'))closeDetail()});
/* 搜索：过滤全表/卡片（代码、名称、备注）；输入池外代码时给「加入自选」建议 */
const searchInput=document.getElementById('search'),addSug=document.getElementById('add-sug');
searchInput.addEventListener('input',()=>{q=searchInput.value.trim();const T=q.toUpperCase();
 if(/^[A-Z]{1,6}$/.test(T)&&!byT[T]&&!wstate.added.includes(T)&&!wstate.removed.includes(T)){addSug.hidden=false;addSug.innerHTML='';const b=document.createElement('button');b.type='button';b.textContent='＋ 把 '+T+' 加入自选（监控池外 · 在线报价）';b.onclick=()=>{toggleWatch(T);addSug.hidden=true;searchInput.value='';q='';renderAll()};addSug.appendChild(b)}else addSug.hidden=true;
 render()});
/* 复制清单：把 config 清单（去掉本机取消的）＋ 页内新增的合成 config.json 片段 */
function copyCfg(){const parts=[];allRows.filter(r=>r.cfgW&&isWatch(r)).forEach(r=>{parts.push(r.note?{ticker:r.ticker,note:r.note}:r.ticker)});extraAdds().forEach(t=>parts.push(t));
 const txt='{"watchlist": { "tickers": ['+parts.map(p=>typeof p==='string'?'"'+p+'"':JSON.stringify(p)).join(', ')+'] }}';
 const done=()=>{const b=document.getElementById('copy-cfg');if(!b)return;b.textContent='✓ 已复制';setTimeout(()=>{b.textContent='复制清单 → config'},1800)};
 if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(done).catch(()=>{fallbackCopy(txt);done()});else{fallbackCopy(txt);done()}}
function fallbackCopy(t){const ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(e){}ta.remove()}
document.getElementById('copy-cfg').onclick=copyCfg;
/* 全量刷新：自选计数（chip/KPI）→ 自选面板 → 全表 */
function renderAll(){const n=watchTotal();if(chipEls.watch)chipEls.watch.querySelector('b').textContent=n;const kw=document.getElementById('kpi-watch');if(kw)kw.textContent=n;renderWatchPanel();render()}
/* RSI 周期切换：表头/chips/KPI/hero/表格/卡片/弹层全部联动（主口径 JSON groups 仍为 RSI6） */
function applyRsi(p){rsiP=p;try{localStorage.setItem('usmon.rsi.v1',p)}catch(e){}
 const sw=document.getElementById('rswitch');if(sw)[...sw.querySelectorAll('.charttab')].forEach(b=>b.classList.toggle('on',b.dataset.p===p));
 const thR=document.getElementById('th-rsi'),thW=document.getElementById('th-wkrsi');if(thR)thR.textContent='RSI'+p+'（日/周）';if(thW)thW.textContent='Vegas 通道（日/周）';
 const c=rsiCounts();const cm={ob:chipEls.ob,os:chipEls.os,obr:chipEls.obr,osr:chipEls.osr,wob:chipEls.wob,wos:chipEls.wos,wret:chipEls.wret};
 Object.entries(cm).forEach(([k,el])=>{if(el)el.querySelector('b').textContent=c[k]});
 const ko=document.getElementById('kpi-ob'),ks=document.getElementById('kpi-os');if(ko)ko.textContent=c.ob;if(ks)ks.textContent=c.os;
 renderHero();renderAll()}
document.querySelectorAll('#rswitch .charttab').forEach(b=>{b.onclick=()=>applyRsi(b.dataset.p)});
applyRsi(rsiP);
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
  if (opts.html !== false) {
    writeFileSync(files.html, htmlPayload(data));
    outputs.push(files.html);
    const kl = klinePayload(data);
    if (kl) {
      files.klines = path.join(outDir, 'klines.json');
      writeFileSync(files.klines, JSON.stringify(kl));
      outputs.push(files.klines);
    }
  }
  return outputs;
}
