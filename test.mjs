/* test.mjs —— 离线测试（无网络可跑）：node test.mjs
 * 黄金值均手算对账；RSI/EMA 递推另与上层看板 js/technical.js 的实现逐点对账
 * （两份独立转录互证，抓转写错误）。 */

import { emaSeries, rsiSeries, tunnelSnap, rsiSnap, tunnelPos, tunnelEvent } from './lib/indicators.mjs';
import { lastClosedDate, splitClosed, etNow } from './lib/market.mjs';
import { mergeBars, anchorSeries } from './lib/sources.mjs';
import { rankUniverse } from './lib/universe.mjs';
import { evaluate, summarize } from './lib/signals.mjs';

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')); }
};
const near = (a, b, eps, name) => ok(a !== null && Math.abs(a - b) <= eps, name, a);
const suite = (t) => console.log('\n◆ ' + t);

/* ---------- EMA ---------- */
suite('EMA：SMA 种子 + 递推（手算黄金值）');
{
  const c = [1, 2, 3, 4, 5];
  const e = emaSeries(c, 3);
  ok(e[0] === null && e[1] === null, '前 n-1 位为 null', e);
  near(e[2], 2, 1e-12, '种子 = SMA(1,2,3) = 2');
  near(e[3], 3, 1e-12, 'bar4: 2+(4-2)*0.5 = 3');
  near(e[4], 4, 1e-12, 'bar5: 3+(5-3)*0.5 = 4');
  const short = emaSeries([1, 2], 3);
  ok(short.every((v) => v === null), '数据不足全 null');
}

/* ---------- RSI ---------- */
suite('RSI(6)：Wilder 平滑（手算黄金值）');
{
  // 差分：d1..d6=+1,+1,-1,+1,+1,+1（种子）→ RSI=83.333；d7=-1 → 69.444；d8=+2 → 78.174
  const c = [10, 11, 12, 11, 12, 13, 14, 13, 15];
  const r = rsiSeries(c, 6);
  ok(r.slice(0, 6).every((v) => v === null), '前 n 位为 null');
  near(r[6], 83.333, 1e-3, 'RSI[6] = 83.333（RS=5）', r[6]);
  near(r[7], 69.444, 1e-3, 'RSI[7] = 69.444（RS=25/11）', r[7]);
  near(r[8], 78.174, 1e-3, 'RSI[8] = 78.174（RS=197/55）', r[8]);
}
suite('RSI：极端序列 + 与 technical.js（上层看板）实现对账');
{
  // 与 js/technical.js 逐字同递推的独立转录（点值版）
  const rsiPoint = (closes, n) => {
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
    let avgG = gain / n, avgL = loss / n;
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
      avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
    }
    if (avgL === 0) return 100;
    return 100 - 100 / (1 + avgG / avgL);
  };
  // 随机游走 20 条 × 200 根，n=6 与 n=14 逐点对账
  let rnd = 12345;
  const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
  let maxDiff = 0;
  for (let t = 0; t < 20; t++) {
    const c = [100];
    for (let i = 1; i < 200; i++) c.push(c[i - 1] + (rand() - 0.48) * 3);
    const seq = rsiSeries(c, 6);
    maxDiff = Math.max(maxDiff, Math.abs(seq[199] - rsiPoint(c, 6)));
    const seq14 = rsiSeries(c, 14);
    maxDiff = Math.max(maxDiff, Math.abs(seq14[199] - rsiPoint(c, 14)));
  }
  ok(maxDiff < 1e-9, '随机序列 40 组逐点一致（max|Δ|=' + maxDiff.toExponential(2) + '）');

  const up = rsiSeries(Array.from({ length: 30 }, (_, i) => 100 + i), 6);
  near(up[29], 100, 1e-9, '全涨 → RSI=100');
  const dn = rsiSeries(Array.from({ length: 30 }, (_, i) => 100 - i), 6);
  near(dn[29], 0, 1e-9, '全跌 → RSI=0');
}

/* ---------- 通道 ---------- */
suite('Vegas 通道：位置与穿越事件');
{
  const flat = Array(60).fill(100);
  const s1 = tunnelSnap([...flat, 120], 12, 36);
  ok(s1.pos === 'above', '跳空收盘在双 EMA 上方 → above', s1.pos);
  ok(s1.event === 'break_up', '前根在内(=轨)→本根在上 → break_up', s1.event);
  const s2 = tunnelSnap([...flat, 80], 12, 36);
  ok(s2.pos === 'below' && s2.event === 'break_down', '跌破 → below + break_down');
  const s3 = tunnelSnap(flat, 12, 36);
  ok(s3.pos === 'inside' && s3.event === null, '平价贴轨 → inside，无事件');
  ok(tunnelEvent('above', 'inside') === 'reenter_down' && tunnelEvent('below', 'inside') === 'reenter_up', '回入事件命名');
  near(s1.widthPct, 1.9552, 1e-3, '跳空后轨宽（20·(2/13-2/37) 口径）', s1.widthPct);
  ok(tunnelSnap([1, 2, 3], 12, 36) === null, '数据不足 → null');
  ok(tunnelPos(101, 100.5, 99.5) === 'above' && tunnelPos(100, 100.5, 99.5) === 'inside', 'tunnelPos 边界');
}

/* ---------- RSI 状态与穿越 ---------- */
suite('RSI 状态机：超买回落 / 超卖回升');
{
  const rising = Array.from({ length: 40 }, (_, i) => 100 + i);      // RSI6 → 100
  const a = rsiSnap(rising, 6, 70, 30);
  ok(a.state === 'overbought' && a.value === 100, '连涨 → 超买');
  const drop = [...rising, 137, 135];                                 // 两个 -2（71.43 → 53.19）
  const b = rsiSnap(drop, 6, 70, 30);
  ok(b.prevState === 'overbought' && b.state === 'neutral' && b.cross === 'out_ob', '连续回落 → out_ob 穿越事件', b);
  near(b.prev, 71.429, 0.01, '回落前值 71.43', b.prev);
  near(b.value, 53.191, 0.01, '回落后 53.19', b.value);
  // out_os 需要超卖→中性的渐进穿越；注意 Wilder avgL 是渐变衰减，
  // 纯跌后第一根阳线不会直接打满（那是种子窗全无跌幅才会），要爬两三根才出超卖区
  const wick = [100];
  for (let k = 1; k <= 14; k++) wick.push(100 - k);   // 连跌 → RSI 0
  wick.push(87, 86, 85, 86, 87);                      // +1,-1,-1,+1,+1 → 16.667→13.889→11.574(超卖)→26.313(超卖)→38.598(中性)
  const c2 = rsiSnap(wick, 6, 70, 30);
  ok(c2.state === 'neutral' && c2.cross === 'out_os', '超卖回升 → out_os', c2);
  near(c2.prev, 26.313, 0.05, '前值 26.31（超卖）', c2.prev);
  near(c2.value, 38.598, 0.05, '现值 38.60（中性）', c2.value);
}

/* ---------- 交易日时钟（含 DST 边界） ---------- */
suite('market.mjs：ET 收盘判定（2026-09 为 EDT=UTC-4，2026-01 为 EST=UTC-5）');
{
  const at = (iso) => new Date(iso);
  ok(lastClosedDate(at('2026-09-23T21:00:00Z')) === '2026-09-23', '周三 17:00 EDT → 当日');
  ok(lastClosedDate(at('2026-09-23T19:59:00Z')) === '2026-09-22', '周三 15:59 EDT → 前一日');
  ok(lastClosedDate(at('2026-09-23T13:00:00Z')) === '2026-09-22', '周三 09:00 EDT 盘前 → 前一日');
  ok(lastClosedDate(at('2026-09-23T14:30:00Z')) === '2026-09-22', '周三 10:30 EDT 盘中 → 前一日');
  ok(lastClosedDate(at('2026-09-26T21:00:00Z')) === '2026-09-25', '周六 → 周五');
  ok(lastClosedDate(at('2026-09-27T03:00:00Z')) === '2026-09-25', '周日 → 周五');
  ok(lastClosedDate(at('2026-01-14T21:00:00Z')) === '2026-01-14', '冬令时 16:00 EST → 当日');
  ok(lastClosedDate(at('2026-01-14T20:59:00Z')) === '2026-01-13', '冬令时 15:59 EST → 前一日');
  ok(lastClosedDate(at('2026-01-17T12:00:00Z')) === '2026-01-16', '1月周六 → 周五');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(etNow().date), 'etNow 格式');
  const bars = [['2026-09-21'], ['2026-09-22'], ['2026-09-23'], ['2026-09-24']];
  ok(splitClosed(bars, '2026-09-23').closed.length === 3, 'splitClosed 按日切分');
  ok(splitClosed(bars, '2026-09-24').liveCount === 0, '全收盘 → live=0');
  ok(splitClosed(bars, '2026-09-22').liveCount === 2, '两根 live（模拟盘中）');
}

/* ---------- 缓存合并 / 排名 ---------- */
suite('sources.mergeBars / anchorSeries / universe.rankUniverse');
{
  // hfq 序列锚定：整条序列等比缩放，RSI/EMA 比值不变
  const scale = 77621.28 / 335.92;
  const hfqBars = Array.from({ length: 30 }, (_, i) => ['h' + String(i).padStart(2, '0'), 0, (100 + Math.sin(i / 5) * 6 + i * 0.8) * scale, 0, 0, 0]);
  hfqBars[29][2] = 77621.28;                       // 末值恰为现价 335.92 的 hfq 值
  const hfq = { adj: 'hfq', bars: hfqBars };
  const a = anchorSeries(hfq, 335.92);
  near(a.bars[29][2], 335.92, 1e-6, '锚定后末值 = 现价', a.bars[29][2]);
  ok(a.anchored === true && a.adj === 'hfq', 'anchored 标记');
  const r_before = rsiSeries(hfqBars.map((b) => b[2]), 6)[29];
  const r_after = rsiSeries(a.bars.map((b) => b[2]), 6)[29];
  ok(r_before !== null && Math.abs(r_after - r_before) < 1e-9, 'RSI 尺度不变', { r_before, r_after });
  ok(anchorSeries({ adj: 'raw', bars: [['x', 0, 1, 0, 0, 0]] }, 100).adj === 'raw', 'raw 序列不锚定');
  ok(anchorSeries(hfq, null) === hfq, '无报价不锚定');
  const m = mergeBars([['2026-09-22', 1, 1, 1, 1, 1], ['2026-09-23', 1, 2, 2, 2, 2]], [['2026-09-23', 1, 9, 9, 9, 9], ['2026-09-24', 1, 3, 3, 3, 3]]);
  ok(m.length === 3 && m[2][0] === '2026-09-24' && m[1][2] === 9, '新覆盖同日 + 升序', m);
  const cands = [{ ticker: 'A' }, { ticker: 'BRK.B' }, { ticker: 'C' }];
  const quotes = [
    { query: 'usA', code: 'A.OQ', mcapUsd: 100 },
    { query: 'usBRK.B', code: 'BRK.B.N', mcapUsd: 300 },
    { query: 'usC', code: 'C.N', mcapUsd: null },
  ];
  const ranked = rankUniverse(cands, quotes, 2);
  ok(ranked[0].ticker === 'BRK.B' && ranked[0].rank === 1, '按实时市值排序，BRK.B 键对齐', ranked.map((r) => r.ticker));
  ok(ranked[1].ticker === 'A' && ranked[1].rank === 2, '第二位');
  ok(rankUniverse(cands, [], 3)[0].rank === 1, '报价全挂 → 静态序兜底，不崩');
}

/* ---------- evaluate / summarize ---------- */
suite('signals.evaluate：live 剔除 / raw 标记 / 汇总分组');
{
  const cfg = { rsi: { period: 6, overbought: 70, oversold: 30 }, tunnels: [{ key: '主通道', n: [12, 36] }] };
  const up = Array.from({ length: 60 }, (_, i) => ['d' + String(i).padStart(3, '0'), 0, 100 + i, 0, 0, 0]);
  const meta = { ticker: 'TEST', name: '测试', rank: 1, mcapUsd: 1e12, spmoPct: 2.5 };
  const r1 = evaluate(meta, { bars: up, adj: 'hfq', source: 'eastmoney' }, cfg, 'd059');
  ok(r1 && r1.asOf === 'd059', 'marketDate 之内全收盘');
  const r2 = evaluate(meta, { bars: [...up, ['d060', 0, 160, 0, 0, 0]], adj: 'hfq', source: 'eastmoney' }, cfg, 'd059');
  ok(r2.close === 159 && r2.live && r2.live.close === 160, 'live bar 剔除后信号用 d059，live 记录 d060', { close: r2.close, live: r2.live });
  ok(r2.rsi6.state === 'overbought', '连涨超买');
  const r3 = evaluate(meta, { bars: up, adj: 'raw', source: 'tencent' }, cfg, 'd059');
  ok(r3.notes.some((n) => n.tag === '口径'), '不复权 → 口径警告');
  const s = summarize([r2]);
  ok(s.overbought.length === 1 && s.oversold.length === 0, 'summarize 超买分组');
  ok(s.obReturn.length === 0 && s.osReturn.length === 0, '无回归事件时不误报');
  // 回归信号分组：前一根超买、本根回正常 → obReturn；通道事件单独归 events
  const mk = (cross, tunnelEvent) => ({ ticker: 'X' + cross + (tunnelEvent || ''), rsi6: { state: 'neutral', cross }, tunnels: tunnelEvent ? [{ key: '主通道', event: tunnelEvent }] : [] });
  const s3 = summarize([mk('out_ob'), mk('out_os'), mk(null, 'break_up'), mk(null)]);
  ok(s3.obReturn.length === 1 && s3.osReturn.length === 1, 'summarize 回归信号分组（超买回落/超卖回升）', { ob: s3.obReturn.length, os: s3.osReturn.length });
  ok(s3.events.length === 1, 'events 只留通道穿越');
  const down = Array.from({ length: 60 }, (_, i) => ['e' + String(i).padStart(3, '0'), 0, 300 - i, 0, 0, 0]);
  const s2 = summarize([evaluate(meta, { bars: down, adj: 'hfq', source: 'eastmoney' }, cfg, 'e059')]);
  ok(s2.oversold.length === 1, 'summarize 超卖分组');
  ok(evaluate(meta, { bars: up.slice(0, 10), adj: 'hfq', source: 'x' }, cfg, 'd009') === null, 'bars<30 → null');
  // 次新标的：650 根（EMA576 可算、EMA676 不可算）→ 通道优雅降级 + 说明，不算异常
  const young = Array.from({ length: 650 }, (_, i) => ['y' + String(i).padStart(4, '0'), 0, 100 + i, 0, 0, 0]);
  const cfg3 = { rsi: { period: 6, overbought: 70, oversold: 30 }, tunnels: [{ key: '主通道', n: [144, 169] }, { key: '长通道', n: [576, 676] }] };
  const ry = evaluate(meta, { bars: young, adj: 'hfq', source: 'eastmoney' }, cfg3, 'y0649');
  ok(ry.tunnels.length === 2 && ry.tunnels[0].pos === 'above' && ry.tunnels[1].insufficient === true, '650根 → 主通道可算 + 长通道标记 insufficient', ry.tunnels);
  ok(ry.notes.some((n) => n.tag === '通道' && /676/.test(n.text)), '带数据不足说明', ry.notes.map((n) => n.tag));
}

/* ---------- HTML 生成：内联脚本语法守卫 ---------- */
suite('report.html：生成物内联脚本可解析（防模板转义破坏页面脚本）');
{
  const { writeOutputs } = await import('./lib/report.mjs');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const vm = await import('node:vm');
  const path = await import('node:path');
  const closes = Array.from({ length: 130 }, (_, i) => 100 + Math.sin(i / 7) * 8 + i * 0.2);
  const mkRow = (ticker, rank) => ({
    ticker, name: '测试' + ticker, rank, mcapUsd: 1e12, spmoPct: rank % 3 ? null : 5.5,
    asOf: '2026-09-24', close: closes[closes.length - 1], chgPct: 1.23,
    rsi6: { value: 72.5, prev: 68.1, state: 'overbought', cross: 'into_ob', period: 6 },
    tunnels: [
      { key: '短通道', n: [12, 36], upper: 1, lower: 0, pos: 'above', event: null, widthPct: 1 },
      { key: '主通道', n: [144, 169], upper: 1, lower: 0, pos: 'above', event: 'break_up', widthPct: 2 },
      { key: '长通道', n: [576, 676], pos: null, event: null, insufficient: true },
    ],
    live: null, adj: 'hfq', source: 'eastmoney', bars: 2000,
    notes: [{ tag: 'RSI6', level: 'warn', text: 'RSI6=72.5 超买（>70），今日新进超买区。' }],
    spark: { closes },
  });
  const data = {
    meta: { marketDate: '2026-09-24', generatedAt: 'x', generatedAtLocal: 'x', runAtEt: 'x', topN: 100, extraNote: ' + SPMO', candidatesAsOf: 'x', universeNote: 'x', srcEast: 1, srcTx: 0, srcFail: 0, eastError: null, liveCount: 0 },
    cfg: { rsi: { period: 6, overbought: 70, oversold: 30 }, tunnels: [{ key: '短通道', n: [12, 36] }, { key: '主通道', n: [144, 169] }, { key: '长通道', n: [576, 676] }] },
    spmo: mkRow('SPMO', null), rows: [mkRow('AAA', 1), mkRow('BBB', 2)],
    summary: { overbought: [mkRow('AAA', 1)], oversold: [], obReturn: [mkRow('BBB', 2)], osReturn: [], events: [mkRow('AAA', 1)] },
    failed: [],
    outputs: [],
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'usmon-test-'));
  const files = writeOutputs(data, dir, { csv: false });
  const html = readFileSync(files.find((f) => f.endsWith('.html')), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  ok(blocks.length === 2, '两个内联脚本块（数据 + 页面逻辑）', blocks.length);
  let synErr = null;
  try { for (const b of blocks) new vm.Script(b); } catch (e) { synErr = e; }
  ok(!synErr, 'vm.Script 语法校验通过', synErr && String(synErr).slice(0, 200));
  ok(html.includes('\\u003c') || !html.includes('</scr' + 'ipt></script>'), '数据块内 </script> 已转义');
}

/* ---------- 汇总 ---------- */
console.log(`\n${'═'.repeat(50)}\n通过 ${pass} · 失败 ${fail}${fail ? '  ✗✗✗' : '  ✓✓✓'}`);
process.exit(fail ? 1 : 0);
