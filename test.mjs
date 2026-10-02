/* test.mjs —— 离线测试（无网络可跑）：node test.mjs
 * 黄金值均手算对账；RSI/EMA 递推另与上层看板 js/technical.js 的实现逐点对账
 * （两份独立转录互证，抓转写错误）。 */

import { emaSeries, rsiSeries, tunnelSnap, rsiSnap, tunnelPos, tunnelEvent } from './lib/indicators.mjs';
import { lastClosedDate, splitClosed, etNow } from './lib/market.mjs';
import { mergeBars, anchorSeries } from './lib/sources.mjs';
import { rankUniverse, normalizeWatchlist, splitWatchlist, watchTargetOf, loadNdx } from './lib/universe.mjs';
import { resampleWeekly, weekEndOf } from './lib/weekly.mjs';
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
suite('sources.mergeBars / anchorSeries / parseYahoo / universe.rankUniverse');
{
  // Yahoo 解析：时间戳→ET 日期、null 过滤、adjclose 优先、OHLC 按比例复权（否则蜡烛全是横线）
  const { parseYahoo } = await import('./lib/sources.mjs');
  const sample = JSON.stringify({
    chart: { result: [{
      timestamp: [1758648000, 1758734400, 1758820800, 1758907200],
      indicators: {
        quote: [{ open: [1, 2, 3, 4], high: [1.5, 2.5, 3.5, 4.5], low: [0.9, 1.9, 2.9, 3.9], close: [1, null, 3, 4] }],
        adjclose: [{ adjclose: [10, 20, 30, 40] }],
      },
    }] },
  });
  const yb = parseYahoo(sample);
  ok(yb[0][1] === 10 && yb[0][3] === 15 && yb[0][4] === 9, '首根 o/h/l 按 adjclose/close 比例缩放', yb[0]);
  ok(yb.some((b) => b[3] > b[4]), '存在真实高低差（不再全是横线）');
  ok(yb.every((b) => b[3] >= b[2] && b[4] <= b[2]), 'high≥close≥low 恒成立');
  ok(yb.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b[0])), 'ET 日期格式');
  ok(yb.every((b, i) => i === 0 || yb[i - 1][0] <= b[0]), '升序');
  ok(yb[0][2] === 10, 'adjclose 优先于 close', yb[0][2]);
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
  // 成分标注：NDX 集合命中 → ndx:true；未传集合 → null（旧调用兼容）
  const rankedNdx = rankUniverse(cands, quotes, 3, new Set(['A', 'BRK.B']));
  ok(rankedNdx[0].ndx === true && rankedNdx[1].ndx === true && rankedNdx[2].ndx === false, 'rankUniverse 纳指100 成员标注', rankedNdx.map((r) => r.ndx));
  ok(rankUniverse(cands, quotes, 2)[0].ndx === null && rankUniverse(cands, quotes, 2)[0].ndx !== undefined, '不传 NDX 集合 → ndx=null（向后兼容）');
  const ndxSnap = loadNdx();
  ok(ndxSnap.set.size >= 95 && ndxSnap.set.has('AAPL') && ndxSnap.set.has('ASML') && !ndxSnap.set.has('TSM'), 'loadNdx 快照：ASML 在列（纳指100）、TSM 不在（纽交所ADR）', ndxSnap.set.size);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(ndxSnap.asOf), 'NDX 快照带 asOf', ndxSnap.asOf);
}

/* ---------- 周线重采样 ---------- */
suite('weekly.mjs：weekEndOf 周五标签 + 日线→周线聚合（O=周首 C=周末 H/L=极值 V=求和）');
{
  ok(weekEndOf('2026-09-23') === '2026-09-25', '周三 → 本周周五 09-25', weekEndOf('2026-09-23'));
  ok(weekEndOf('2026-09-25') === '2026-09-25', '周五 → 当天');
  ok(weekEndOf('2026-09-28') === '2026-10-02', '周一 → 当周周五（跨月）', weekEndOf('2026-09-28'));
  ok(weekEndOf('2026-01-01') === '2026-01-02', '元旦周四 → 周五（闭市日也作标签）');
  ok(weekEndOf('垃圾') === null, '非法日期 → null');
  // 两周半的日线：第一周 3 根（涨），第二周 2 根（跌），第三周 1 根
  const bars = [
    ['2026-09-21', 10, 11, 12, 9, 100],
    ['2026-09-22', 11, 13, 14, 10, 200],
    ['2026-09-23', 13, 12, 15, 8, 300],
    ['2026-09-28', 12, 11, 13, 10, 400],
    ['2026-09-29', 11, 10, 12, 9, 500],
    ['2026-10-05', 10, 12, 12, 10, 600],
  ];
  const w = resampleWeekly(bars);
  ok(w.length === 3, '3 个自然周 → 3 根周线', w.map((x) => x[0]));
  ok(w[0][0] === '2026-09-25' && w[1][0] === '2026-10-02' && w[2][0] === '2026-10-09', '周标签 = 各周周五', w.map((x) => x[0]));
  ok(w[0][1] === 10 && w[0][2] === 12 && w[0][3] === 15 && w[0][4] === 8, '首周 O=10 C=12 H=15 L=8', w[0]);
  ok(w[0][5] === 600, '首周量求和 100+200+300', w[0][5]);
  ok(w[1][2] === 10 && w[1][1] === 12, '次周开=周首 12 收=周末 10', w[1]);
  ok(resampleWeekly([]).length === 0 && resampleWeekly(null).length === 0, '空输入 → 空');
  const one = resampleWeekly([['2026-09-24', 5, 6, 7, 4, 10]]);
  ok(one.length === 1 && one[0][0] === '2026-09-25', '单根成周');
}

/* ---------- 自选/持仓清单 ---------- */
suite('universe：watchlist 归一化 / 池内外拆分 / 池外目标构造');
{
  const wl = normalizeWatchlist({
    tickers: ['NVDA', { ticker: 'qqq', note: '池外ETF' }, { ticker: 'SPMO' }, 'nvda', { ticker: 'BRK.B', note: '  现金替代  ' }, { note: '没有代码' }, '', { ticker: 'XLK', note: 42 }],
  });
  ok(wl.length === 5, '字符串/对象混合，去重（大小写不敏感）、跳过空与缺代码', wl.map((x) => x.ticker));
  ok(wl[0].ticker === 'NVDA' && wl[0].note === '', '纯字符串 → 无备注');
  ok(wl[1].ticker === 'QQQ' && wl[1].note === '池外ETF', '对象形态，代码大写 + 备注');
  ok(wl[4].note === '42', '备注数字转字符串', wl[4].note);
  ok(normalizeWatchlist(undefined).length === 0 && normalizeWatchlist({}).length === 0, '未配置/空配置 → 空清单');
  ok(normalizeWatchlist({ tickers: 'NVDA' }).length === 0, 'tickers 非数组 → 空清单（容错）');

  // 池内外拆分：池内就地打标、池外进入 extra；SPMO 也在 targets 里同样命中
  const targets = [
    { ticker: 'SPMO', name: '标普500动量ETF', rank: null },
    { ticker: 'NVDA', name: '英伟达', rank: 1 },
    { ticker: 'AAPL', name: '苹果', rank: 2 },
  ];
  const { extra } = splitWatchlist(targets, [{ ticker: 'NVDA', note: '' }, { ticker: 'QQQ', note: '池外ETF' }, { ticker: 'SPMO', note: '核心' }]);
  ok(extra.length === 1 && extra[0].ticker === 'QQQ' && extra[0].note === '池外ETF', '只有池外标的进 extra', extra);
  const nvda = targets.find((t) => t.ticker === 'NVDA');
  const spmo = targets.find((t) => t.ticker === 'SPMO');
  ok(nvda.watch === true && nvda.watchNote === '', '池内标的就地打 watch 标');
  ok(spmo.watch === true && spmo.watchNote === '核心', 'SPMO 命中同样打标');
  ok(targets.find((t) => t.ticker === 'AAPL').watch === undefined, '未命中不受影响');

  const wt = watchTargetOf({ ticker: 'QQQ', note: '池外ETF' }, { query: 'usQQQ', code: 'QQQ.OQ', name: '纳指100ETF', price: 512.3 });
  ok(wt.ticker === 'QQQ' && wt.rank === null && wt.spmoPct === null, '池外目标：无排名无 SPMO 权重');
  ok(wt.name === '纳指100ETF' && wt.quotePrice === 512.3, '报价补名称 + 现价锚');
  ok(wt.tvSymbol === 'NASDAQ:QQQ', '报价后缀 → TradingView 交易所前缀', wt.tvSymbol);
  ok(wt.watch === true && wt.watchNote === '池外ETF', '带 watch 标与备注');
  const wt2 = watchTargetOf({ ticker: 'QQQ', note: '' }, null);
  ok(wt2.name === 'QQQ' && wt2.quotePrice === null && wt2.tvSymbol === 'QQQ', '报价缺失 → 退回裸代码，仍可跑');
}

/* ---------- evaluate / summarize ---------- */
suite('signals.evaluate：live 剔除 / raw 标记 / 汇总分组');
{
  const cfg = { rsi: { period: 6, period2: 14, overbought: 70, oversold: 30 }, tunnels: [{ key: '主通道', n: [12, 36] }] };
  const up = Array.from({ length: 60 }, (_, i) => ['d' + String(i).padStart(3, '0'), 0, 100 + i, 0, 0, 0]);
  const meta = { ticker: 'TEST', name: '测试', rank: 1, mcapUsd: 1e12, spmoPct: 2.5 };
  const r1 = evaluate(meta, { bars: up, adj: 'hfq', source: 'eastmoney' }, cfg, 'd059');
  ok(r1 && r1.asOf === 'd059', 'marketDate 之内全收盘');
  const r2 = evaluate(meta, { bars: [...up, ['d060', 0, 160, 0, 0, 0]], adj: 'hfq', source: 'eastmoney' }, cfg, 'd059');
  ok(r2.close === 159 && r2.live && r2.live.close === 160, 'live bar 剔除后信号用 d059，live 记录 d060', { close: r2.close, live: r2.live });
  ok(r2.rsi6.state === 'overbought', '连涨超买');
  // 第二周期 RSI（默认14）：同阈值，独立数值
  ok(r2.rsi14 && r2.rsi14.period === 14, 'evaluate 带 rsi14（period 14）', r2.rsi14 && r2.rsi14.period);
  ok(r2.rsi14.value > 70 && r2.rsi14.state === 'overbought', '连涨序列 RSI14 也超买', r2.rsi14 && +r2.rsi14.value.toFixed(1));
  ok(r2.rsi14.value <= r2.rsi6.value || r2.rsi14.value === 100, 'RSI14 平滑更慢（不超前 RSI6）', { r6: r2.rsi6.value, r14: r2.rsi14.value });
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
  // 假日期（无法归周）→ wk=null 不崩，各端按缺失显示
  ok(ry.wk === null && r2.wk === null, '假日期序列 → wk=null（容错）', { ry: ry.wk, r2: r2.wk });
}

/* ---------- 周线 evaluate（真实日期） ---------- */
suite('signals.evaluate 周线块：40 周真实日历日线 → 周RSI/周通道/周标签');
{
  const metaW = { ticker: 'WKLY', name: '周线测试', rank: 1, sp500: true, ndx: true };
  const cfgW = { rsi: { period: 6, period2: 14, overbought: 70, oversold: 30 }, tunnels: [{ key: '短通道', n: [12, 36] }, { key: '长通道', n: [576, 676] }] };
  // 2026-01-05 是周一：40 周 × 5 个交易日，逐日上涨
  const wbars = [];
  for (let wi = 0; wi < 40; wi++) for (let d = 0; d < 5; d++) {
    const iso = new Date(Date.UTC(2026, 0, 5 + wi * 7 + d)).toISOString().slice(0, 10);
    wbars.push([iso, 0, 100 + wi * 5 + d, 0, 0, 0]);
  }
  const rw = evaluate(metaW, { bars: wbars, adj: 'hfq', source: 'eastmoney' }, cfgW, wbars[wbars.length - 1][0]);
  ok(rw && rw.wk && rw.wk.bars === 40, '40 周日线 → 40 根周线', rw.wk && rw.wk.bars);
  ok(rw.wk.rsi6 && rw.wk.rsi6.state === 'overbought', '周线RSI6 超买（逐周上涨）', rw.wk.rsi6);
  ok(rw.wk.rsi14 && rw.wk.rsi14.period === 14 && rw.wk.rsi14.state === 'overbought', '周线RSI14 同参同判（超买）', rw.wk.rsi14);
  ok(rw.wk.tunnels[0].pos === 'above' && rw.wk.tunnels[0].insufficient === undefined, '周线短通道(12/36周)可算 → above', rw.wk.tunnels[0]);
  ok(rw.wk.tunnels[1].insufficient === true, '周线长通道(576/676周) → insufficient');
  ok(rw.wk.asOf === weekEndOf(wbars[199][0]) && rw.wk.asOf === rw.asOf, '周线 asOf = 本周周五标签', rw.wk.asOf);
  ok(rw.sp500 === true && rw.ndx === true, '成分标志透传到行');
  ok(rw.notes.some((n) => n.tag === '周RSI6' && /超买/.test(n.text)), '周线超买 notes 在场', rw.notes.map((n) => n.tag));
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
    wk: { asOf: '2026-09-25', bars: 260, rsi6: { value: 55.5, prev: 61.2, state: 'neutral', cross: null, period: 6 }, rsi14: { value: 48.2, prev: 51.0, state: 'neutral', cross: null, period: 14 }, tunnels: [{ key: '短通道', n: [144, 169], upper: 2, lower: 1, pos: 'above', event: null, widthPct: 3 }, { key: '主通道', n: [288, 338], pos: 'inside', event: null }, { key: '长通道', n: [576, 676], pos: null, event: null, insufficient: true }], live: null, k: { d: ['2026-09-25'], o: [1], h: [2], l: [0.5], c: [1], e: [[1], [1], [1], [1], [1], [1]] } },
    rsi14: { value: 63.4, prev: 60.2, state: 'neutral', cross: null, period: 14 },
    sp500: true, ndx: ticker === 'BBB' ? true : false,
    notes: [{ tag: 'RSI6', level: 'warn', text: 'RSI6=72.5 超买（>70），今日新进超买区。' }],
    spark: { closes },
  });
  const data = {
    meta: { marketDate: '2026-09-24', generatedAt: 'x', generatedAtLocal: 'x', runAtEt: 'x', topN: 100, extraNote: ' + SPMO', candidatesAsOf: 'x', universeNote: 'x', srcEast: 1, srcTx: 0, srcFail: 0, eastError: null, liveCount: 0, watchCount: 1 },
    cfg: { rsi: { period: 6, overbought: 70, oversold: 30 }, tunnels: [{ key: '短通道', n: [12, 36] }, { key: '主通道', n: [144, 169] }, { key: '长通道', n: [576, 676] }] },
    spmo: mkRow('SPMO', null), rows: [mkRow('AAA', 1), mkRow('BBB', 2)],
    summary: { overbought: [mkRow('AAA', 1)], oversold: [], obReturn: [mkRow('BBB', 2)], osReturn: [], events: [mkRow('AAA', 1)] },
    failed: [],
    outputs: [],
  };
  data.rows[1].watch = true; data.rows[1].note = '池外ETF';
  const dir = mkdtempSync(path.join(tmpdir(), 'usmon-test-'));
  const files = writeOutputs(data, dir, {});
  const html = readFileSync(files.find((f) => f.endsWith('.html')), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  ok(blocks.length === 4, '四个内联脚本块（SW注册 + lightweight-charts + 数据 + 页面逻辑）', blocks.length);
  ok(blocks[0].includes('serviceWorker'), '首块为 SW 注册脚本');
  let synErr = null;
  try { for (const b of blocks) new vm.Script(b); } catch (e) { synErr = e; }
  ok(!synErr, 'vm.Script 语法校验通过', synErr && String(synErr).slice(0, 200));
  ok(html.includes('LightweightCharts'), 'K 线库（lightweight-charts）已内联');
  ok(html.includes('drawK') && html.includes('tv-box'), 'K 线渲染函数与容器在场');
  ok(html.includes('\\u003c') || !html.includes('</scr' + 'ipt></script>'), '数据块内 </script> 已转义');
  // 自选持仓四端呈现
  ok(html.includes('id="watch-panel"') && html.includes('watch-grid') && html.includes('自选持仓'), '自选持仓面板结构在场');
  ok(html.includes("watch:{label:'自选'") && html.includes("cur==='watch'"), '自选 chip 与筛选分支在场');
  ok(html.includes('note-badge') && html.includes('自选备注'), '表格徽标与弹层备注行在场');
  ok(html.includes('wc-top') && html.includes('watch-card'), '自选卡片样式/结构在场');
  // 搜索框 + 页内增删自选（localStorage 叠加层）+ 复制清单 + 弹层开关
  ok(html.includes('id="search"') && html.includes('matchQ'), '搜索框与过滤逻辑在场');
  ok(html.includes('usmon.watch.v1') && html.includes('toggleWatch') && html.includes('isWatch'), '自选增删状态机（localStorage 叠加层）在场');
  ok(html.includes('id="copy-cfg"') && html.includes('copyCfg'), '复制清单按钮在场');
  ok(html.includes('id="detail-star"') && html.includes('cardstar') && html.includes('stcol'), '弹层/卡片/表格自选开关在场');
  ok(html.includes('colspan="10"'), '通道/RSI 收纳后的空态 colspan=10');
  ok(html.includes('<th>信号</th>') && html.includes('sigTags') && html.includes('.tagx.fill-up') && html.includes("'fill-up'"), '信号标签列与实心/描边标签渲染在场');
  // 周线与成分标注呈现
  ok(html.includes('Vegas 通道 日/周') && html.includes('tunDualCell') && html.includes('rsiDualCell'), '周RSI/通道收纳为日/周双行列（tunDualCell/rsiDualCell）');
  ok(html.includes("drawK(r,'w')") && html.includes('kMode') && html.includes('ct-w'), '日/周图表切换在场');
  ok(html.includes('idx-badge') && html.includes('成分指数'), '纳指100 徽标与弹层成分行在场');
  ok(html.includes('周超买') && html.includes("cur==='wob'") && html.includes("cur==='wret'"), '周线 chips 与筛选分支在场');
  ok(html.includes('周线 = 日线按周重采样'), '页脚口径周线说明在场');
  ok(html.includes('liveQuote') && html.includes('fetchExtra'), '池外新增标的在线报价逻辑在场');
  const jobj = JSON.parse(readFileSync(files.find((f) => f.endsWith('.json')), 'utf8'));
  ok(jobj.groups.watch.includes('BBB'), 'groups.watch 收录自选标的', jobj.groups.watch);
  ok(jobj.rows.find((r) => r.ticker === 'BBB').watch === true && jobj.rows.find((r) => r.ticker === 'BBB').note === '池外ETF', '行级 watch/note 进 JSON');
  ok(jobj.meta.watchCount === 1, 'meta.watchCount 计数');
  ok(jobj.groups.weekOverbought && Array.isArray(jobj.groups.weekOverbought) && Array.isArray(jobj.groups.weekReturn), 'groups 周线分组在场', jobj.groups.weekOverbought);
  ok(jobj.rows[0].wk && jobj.rows[0].wk.rsi6 && jobj.rows[0].wk.k === undefined, 'JSON 行带 wk（周线K线数据只进 HTML）');
  ok(jobj.rows[1].ndx === true && jobj.rows[0].sp500 === true, 'sp500/ndx 成员标志进 JSON');
  const csv = readFileSync(files.find((f) => f.endsWith('.csv')), 'utf8');
  ok(csv.includes('自选备注'), 'CSV 表头含自选备注列');
  ok(/BBB,[^]*池外ETF/.test(csv), 'CSV 行带备注', csv.split('\r\n')[2]);
  ok(csv.includes('周RSI6') && csv.includes('成分') && csv.includes('周通道'), 'CSV 周线与成分列在场');
  // RSI14 可选周期
  ok(html.includes('id="rswitch"') && html.includes('usmon.rsi.v1') && html.includes('applyRsi') && html.includes('data-p="14"'), 'RSI6/14 切换开关与状态持久化在场');
  ok(html.includes('th-rsi') && html.includes('th-wkrsi'), 'RSI 表头动态 id 在场');
  ok(csv.includes('RSI14状态') && csv.includes('周RSI14状态'), 'CSV RSI14 日/周列在场');
  ok(jobj.rows[0].rsi14 && jobj.rows[0].rsi14.period === 14 && jobj.rows[0].wk.rsi14, '行级 rsi14 与 wk.rsi14 进 JSON');
}

/* ---------- PWA 资产：manifest/sw.js 守卫 ---------- */
suite('PWA：manifest 可解析 + sw.js 语法');
{
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  ok(manifest.name === 'Meridian' && (manifest.icons || []).length >= 3, 'manifest 名称与三枚图标在场', manifest.name);
  ok(/out\/report\.html/.test(manifest.start_url || ''), 'start_url 直达报告页（跳转页不产生多余历史记录）', manifest.start_url);
  let swErr = null;
  try { new vm.Script(readFileSync('sw.js', 'utf8')); } catch (e) { swErr = e; }
  ok(!swErr, 'sw.js 语法可解析', swErr && String(swErr).slice(0, 200));
}

/* ---------- 汇总 ---------- */
console.log(`\n${'═'.repeat(50)}\n通过 ${pass} · 失败 ${fail}${fail ? '  ✗✗✗' : '  ✓✓✓'}`);
process.exit(fail ? 1 : 0);
