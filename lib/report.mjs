/* report.mjs —— 输出层：控制台表格 / latest.json / CSV / 自包含 HTML
 * HTML 零依赖自包含：数据内联 window.__REPORT__，页内复制一份指标计算
 * （与 lib/indicators.mjs 同口径），图表用内联 SVG，可离线双击打开、
 * 也可提交进仓库用 GitHub Pages 在手机上看。 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

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
    rsi6: r.rsi6, tunnels: r.tunnels, live: r.live, adj: r.adj, anchored: r.anchored || false, source: r.source, bars: r.bars, notes: r.notes,
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
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>美股监控 ${meta.marketDate}</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--fg:#1c1c1e;--mut:#77716a;--line:#e4e0d8;--up:#c0392b;--dn:#1e8449;--hot:#c0392b;--cold:#1e8449;--chipbg:#eee9df}
@media(prefers-color-scheme:dark){:root{--bg:#151412;--card:#1f1e1b;--fg:#e8e4dc;--mut:#948d82;--line:#33302a;--chipbg:#2a2823}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:16px}
.wrap{max-width:1180px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mut);font-size:12px;margin-bottom:12px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.chip{border:1px solid var(--line);background:var(--chipbg);border-radius:999px;padding:3px 12px;cursor:pointer;font-size:13px;user-select:none}
.chip.on{background:var(--fg);color:var(--bg)}
.chip b{font-weight:700}
.hero{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}
.hero .big{font-size:26px;font-weight:700}
.up{color:var(--up)}.dn{color:var(--dn)}.mut{color:var(--mut)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13px}
th,td{padding:6px 8px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th{position:sticky;top:0;background:var(--card);color:var(--mut);font-weight:500;font-size:12px}
td:nth-child(2),th:nth-child(2),td:nth-child(3),th:nth-child(3){text-align:left}
tr.r{cursor:pointer}tr.r:hover{background:var(--chipbg)}
tr.ob td.rsi{color:var(--hot);font-weight:700}tr.os td.rsi{color:var(--cold);font-weight:700}
.badge{font-size:11px;border-radius:4px;padding:0 4px;border:1px solid currentColor}
.tblwrap{overflow:auto;max-height:65vh;border-radius:12px}
#detail{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:16px}
#detail.on{display:flex}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;max-width:960px;width:100%;max-height:92vh;overflow:auto;padding:16px}
.panel h3{margin:0 0 2px}.panel .meta{color:var(--mut);font-size:12px;margin-bottom:8px}
.notes{font-size:12.5px}.notes div{margin:3px 0}
.close-x{float:right;cursor:pointer;color:var(--mut);font-size:18px;border:1px solid var(--line);border-radius:8px;padding:0 8px}
svg{width:100%;height:auto;display:block}
.warn{color:var(--hot)}
.foot{color:var(--mut);font-size:12px;margin-top:14px}
</style></head><body><div class="wrap">
<div><h1>美股监控 <span class="mut" style="font-size:14px">${meta.marketDate} 收盘</span></h1>
<div class="sub">${meta.generatedAtLocal} · SP500 实时市值前 ${meta.topN} + SPMO · RSI6&gt;${cfg.rsi.overbought} 超买 / &lt;${cfg.rsi.oversold} 超卖 · 通道 EMA12/36 · 144/169 · 576/676 · 东财后复权 ${meta.srcEast} / 腾讯兜底 ${meta.srcTx} / 失败 ${meta.srcFail}</div></div>
<div class="chips" id="chips"></div>
<div class="hero" id="hero"></div>
<div class="tblwrap"><table id="tbl"><thead><tr>
<th>排名</th><th>代码</th><th>名称</th><th>收盘</th><th>涨跌</th><th>RSI6</th><th>状态</th><th>短通道</th><th>主通道</th><th>长通道</th><th>SPMO%</th><th>事件</th></tr></thead><tbody></tbody></table></div>
<div class="foot">RSI6 = Wilder 平滑（同通达信/TradingView RMA）· EMA 种子 = 前 n 项 SMA · Vegas 三通道：短 EMA12/36 · 主 EMA144/169（Vegas Tunnel）· 长 EMA576/676。<br>指标只描述事实与常用读法，不构成投资建议。数据来自第三方公开接口，有延迟、会出错。</div>
</div>
<div id="detail"><div class="panel" id="panel"></div></div>
<script>
window.__REPORT__ = ${json};
</script>
<script>
/* 页内指标：与 lib/indicators.mjs 同口径（EMA SMA 种子 + Wilder RSI） */
function emaAt(c,n){if(c.length<n)return null;let s=0;for(let i=0;i<n;i++)s+=c[i];let p=s/n;for(let i=n;i<c.length;i++)p=p+(c[i]-p)*2/(n+1);return p}
function rsiSeries(c,n){const o=Array(c.length).fill(null);if(c.length<n+1)return o;let g=0,l=0;for(let i=1;i<=n;i++){const d=c[i]-c[i-1];if(d>=0)g+=d;else l-=d}let aG=g/n,aL=l/n;o[n]=aL===0?100:100-100/(1+aG/aL);for(let i=n+1;i<c.length;i++){const d=c[i]-c[i-1];aG=(aG*(n-1)+(d>0?d:0))/n;aL=(aL*(n-1)+(d<0?-d:0))/n;o[i]=aL===0?100:100-100/(1+aG/aL)}return o}
const D=window.__REPORT__,POS={above:'上方',inside:'轨内',below:'下方'};
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const pct=v=>Number.isFinite(v)?(v>0?'+':'')+v.toFixed(2)+'%':'--';
const num=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'--';
const byT={};[D.spmo,...D.rows].filter(Boolean).forEach(r=>byT[r.ticker]=r);
/* chips */
const groups={all:'全部('+([D.spmo].filter(Boolean).length+D.rows.length)+')',ob:'超买('+D.groups.overbought.length+')',os:'超卖('+D.groups.oversold.length+')',obr:'超买回落('+((D.groups.obReturn||[]).length)+')',osr:'超卖回升('+((D.groups.osReturn||[]).length)+')',ev:'通道事件('+D.groups.events.length+')',spmo:'SPMO重合'};
let cur='all';
const chips=document.getElementById('chips');
Object.entries(groups).forEach(([k,v])=>{const el=document.createElement('span');el.className='chip'+(k===cur?' on':'');el.innerHTML=v;el.onclick=()=>{cur=k;document.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));el.classList.add('on');render()};chips.appendChild(el)});
/* hero */
(function(){const s=D.spmo;if(!s)return;const h=document.getElementById('hero');
h.innerHTML='<span style="font-weight:700">SPMO</span> <span class="mut">'+esc(s.name)+'</span> · 收盘 <span class="big">'+num(s.close)+'</span> <span class="'+(s.chgPct>=0?'up':'dn')+'">'+pct(s.chgPct)+'</span> · RSI6 <b class="'+(s.rsi6&&s.rsi6.state==='overbought'?'up':s.rsi6&&s.rsi6.state==='oversold'?'dn':'')+'">'+num(s.rsi6?s.rsi6.value:null,1)+'</b> · 通道：'+s.tunnels.map(t=>t.key+' '+(t.pos?POS[t.pos]:'<span class="mut">暂缺</span>')).join(' · ')+'<div class="mut" style="font-size:12px">'+(s.notes||[]).map(n=>esc(n.text)).join(' ')+'</div>'})();
/* table */
function inGroup(r){if(cur==='all')return true;if(cur==='spmo')return r.spmoPct!=null;if(!byT[r.ticker])return false;if(cur==='ob')return D.groups.overbought.includes(r.ticker);if(cur==='os')return D.groups.oversold.includes(r.ticker);if(cur==='obr')return (D.groups.obReturn||[]).includes(r.ticker);if(cur==='osr')return (D.groups.osReturn||[]).includes(r.ticker);return D.groups.events.includes(r.ticker)}
function posCell(t){if(!t||!t.pos)return '<span class="mut">--</span>';const ev=t.event&&t.event.startsWith('break');return (t.pos==='above'?'<span class="up">':t.pos==='below'?'<span class="dn">':'<span class="mut">')+POS[t.pos]+(ev?' ↑↑':'')+'</span>'}
function evTxt(r){const a=[];if(r.rsi6&&r.rsi6.cross)a.push({into_ob:'新进超买',into_os:'新进超卖',out_ob:'超买回落',out_os:'超卖回升'}[r.rsi6.cross]);(r.tunnels||[]).forEach(t=>{if(t.event&&t.event.startsWith('break'))a.push((t.event==='break_up'?'上穿':'下穿')+t.key)});return a.join('、')}
function render(){const tb=document.querySelector('#tbl tbody');tb.innerHTML='';
[D.spmo,...D.rows].filter(Boolean).filter(inGroup).forEach(r=>{const tr=document.createElement('tr');tr.className='r'+(r.rsi6&&r.rsi6.state==='overbought'?' ob':r.rsi6&&r.rsi6.state==='oversold'?' os':'');
tr.innerHTML='<td>'+(r.rank??'★')+'</td><td><b>'+esc(r.ticker)+'</b></td><td>'+esc(r.name)+(r.adj==='raw'?' <span class="warn badge">不复权</span>':'')+'</td><td>'+num(r.close)+'</td><td class="'+(r.chgPct>=0?'up':'dn')+'">'+pct(r.chgPct)+'</td><td class="rsi">'+num(r.rsi6?r.rsi6.value:null,1)+'</td><td>'+(r.rsi6&&r.rsi6.state!=='neutral'?(r.rsi6.state==='overbought'?'超买':'超卖'):'<span class="mut">--</span>')+'</td><td>'+posCell((r.tunnels||[])[0])+'</td><td>'+posCell((r.tunnels||[])[1])+'</td><td>'+posCell((r.tunnels||[])[2])+'</td><td>'+(r.spmoPct!=null?r.spmoPct.toFixed(1)+'%':'')+'</td><td class="mut">'+esc(evTxt(r))+'</td>';
tr.onclick=()=>show(r.ticker);tb.appendChild(tr)})}
/* detail */
function show(tk){const r=byT[tk];if(!r)return;const p=document.getElementById('panel');
p.innerHTML='<span class="close-x" id="detail-close">×</span><h3>'+esc(r.ticker)+' · '+esc(r.name)+(r.rank?' <span class="mut">市值排名 #'+r.rank+'</span>':'')+'</h3><div class="meta">截至 '+esc(r.asOf)+' 收盘 · 收盘 '+num(r.close)+' ('+pct(r.chgPct)+') · RSI6 '+num(r.rsi6?r.rsi6.value:null,1)+' · 数据源 '+esc(r.source)+' · '+(r.adj==='hfq'?'后复权(含拆股分红)':'不复权(拆股会使长通道失真)')+' · '+r.bars+' 根'+(r.spmoPct!=null?' · SPMO持仓 '+r.spmoPct.toFixed(2)+'%':'')+'</div><div class="notes">'+(r.notes||[]).map(n=>'<div>['+esc(n.tag)+'] '+esc(n.text)+'</div>').join('')+'</div>';
document.getElementById('detail-close').onclick=()=>document.getElementById('detail').classList.remove('on');
document.getElementById('detail').classList.add('on')}
document.getElementById('detail').onclick=(e)=>{if(e.target.id==='detail')document.getElementById('detail').classList.remove('on')};
render();
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
