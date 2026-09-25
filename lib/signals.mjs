/* signals.mjs —— 单标的信号评估（纯函数）
 * 输入：一个标的的 closed bars（已剔除未收盘的 live bar）+ 可选 live bar。
 * 输出：事实层（收盘/涨跌/RSI6/三通道位置）+ 描述层（超买/超卖/穿越事件标签）。
 * 铁律同上层看板：只描述事实与常用读法，绝不产出"建议买卖"；
 * 不复权数据打 raw 标记（拆股会让长通道失真，见 sources.mjs 头注）。 */

import { rsiSnap, tunnelSnap } from './indicators.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const TUNNEL_READ = {
  above: '价格在通道上方（趋势多头侧）',
  inside: '价格在通道内（观察区）',
  below: '价格在通道下方（趋势空头侧）',
};
const EVENT_READ = {
  break_up: '当日上穿通道（收盘自下而上）',
  break_down: '当日下穿通道（收盘自上而下）',
  reenter_up: '自下方回到通道内',
  reenter_down: '自上方回到通道内',
};

/* cfg.tunnels: [{key, n:[a,b]}]，cfg.rsi: {period, overbought, oversold} */
export function evaluate(meta, series, cfg, marketDate) {
  const { bars, adj, source } = series;
  if (!Array.isArray(bars) || bars.length < 30) return null;

  // bars 已按日期升序；live bar（日期晚于 marketDate）不计入信号
  const closed = marketDate ? bars.filter((b) => b[0] <= marketDate) : bars;
  const liveBars = bars.length - closed.length;
  if (closed.length < 30) return null;

  const closes = closed.map((b) => b[2]);
  const lastBar = closed[closed.length - 1];
  const prevBar = closed[closed.length - 2];
  const close = lastBar[2];
  const chgPct = prevBar && prevBar[2] ? (close / prevBar[2] - 1) * 100 : null;

  const rsiCfg = cfg.rsi;
  const r = rsiSnap(closes, rsiCfg.period, rsiCfg.overbought, rsiCfg.oversold);

  const tunnels = [];
  for (const t of cfg.tunnels) {
    const s = tunnelSnap(closes, t.n[0], t.n[1]);
    if (s) tunnels.push({ key: t.key, n: t.n, upper: Math.max(s.a, s.b), lower: Math.min(s.a, s.b), pos: s.pos, event: s.event, widthPct: s.widthPct });
    else tunnels.push({ key: t.key, n: t.n, pos: null, event: null, insufficient: true });
  }

  // live bar（盘中参考）：用含 live 的序列重算 RSI 与主通道位置，仅供盘中运行时对照
  let live = null;
  if (liveBars > 0) {
    const allCloses = bars.map((b) => b[2]);
    const lr = rsiSnap(allCloses, rsiCfg.period, rsiCfg.overbought, rsiCfg.oversold);
    const lt = cfg.tunnels.map((t) => tunnelSnap(allCloses, t.n[0], t.n[1]));
    live = { close: bars[bars.length - 1][2], date: bars[bars.length - 1][0], rsi6: lr ? lr.value : null, mainPos: lt[1] ? lt[1].pos : null };
  }

  // 描述标签（事实 + 常用读法，非建议）
  const notes = [];
  // 次新标的（上市/分拆晚于长窗口 EMA 所需根数）：长通道暂不可算，如实标注，不算异常
  const missingT = tunnels.filter((t) => t.insufficient);
  if (missingT.length) {
    notes.push({ tag: '通道', level: 'info', text: `${missingT.map((t) => t.key + '（EMA' + t.n.join('/') + '）').join('、')}数据不足暂未计算：该标的上市/分拆时间短于窗口所需 ${Math.max(...missingT.map((t) => Math.max(...t.n)))} 根日线，随数据积累自动出现。` });
  }
  if (r) {
    if (r.state === 'overbought') {
      notes.push({ tag: 'RSI6', level: r.cross === 'into_ob' ? 'hot' : 'warn', text: `RSI6=${r.value.toFixed(1)} 超买（>${rsiCfg.overbought}）${r.cross === 'into_ob' ? '，今日新进超买区' : ''}。策略语境：超买常是做T减仓的观察信号，强趋势里会持续钝化。` });
    } else if (r.state === 'oversold') {
      notes.push({ tag: 'RSI6', level: 'cold', text: `RSI6=${r.value.toFixed(1)} 超卖（<${rsiCfg.oversold}）${r.cross === 'into_os' ? '，今日新进超卖区' : ''}。策略语境：超卖常是分批吸纳的观察信号，弱势里同样会钝化。` });
    }
    if (r.cross === 'out_ob') notes.push({ tag: 'RSI6', level: 'info', text: `RSI6 自超买回落（前值 ${r.prev.toFixed(1)} → ${r.value.toFixed(1)}）。做T语境下常见做法是观察回补时机，此处只记录事件。` });
    if (r.cross === 'out_os') notes.push({ tag: 'RSI6', level: 'info', text: `RSI6 自超卖回升（前值 ${r.prev.toFixed(1)} → ${r.value.toFixed(1)}）。只记录事件。` });
  }
  for (const t of tunnels) {
    if (t.event === 'break_up') notes.push({ tag: t.key, level: 'info', text: `${t.key}（EMA${t.n[0]}/${t.n[1]}）${EVENT_READ.break_up}。` });
    if (t.event === 'break_down') notes.push({ tag: t.key, level: 'info', text: `${t.key}（EMA${t.n[0]}/${t.n[1]}）${EVENT_READ.break_down}。` });
    if (t.event === 'reenter_up' || t.event === 'reenter_down') notes.push({ tag: t.key, level: 'info', text: `${t.key}：${EVENT_READ[t.event]}。` });
  }
  if (adj === 'raw') notes.push({ tag: '口径', level: 'warn', text: '本行数据为不复权价（东财主源不可用，腾讯兜底）。近一年内有拆股的标的，长通道（EMA576/676）会明显失真，RSI6/主通道参考价值有限。' });

  return {
    ticker: meta.ticker,
    name: meta.name || series.name || meta.ticker,
    rank: meta.rank ?? null,
    mcapUsd: meta.mcapUsd ?? null,
    spmoPct: meta.spmoPct ?? null,
    asOf: lastBar[0],
    close,
    chgPct,
    rsi6: r ? { value: r.value, prev: r.prev, state: r.state, cross: r.cross, period: rsiCfg.period } : null,
    tunnels,
    live,
    adj,
    source,
    bars: closed.length,
    notes,
  };
}

/* 汇总：分组输出。核心是"回归信号"——前一根收盘在超买/超卖区、本根收盘回到
 * 正常区（30~70）：超买回落=做T回补观察，超卖回升=吸纳确认观察。
 * overbought/oversold 仍单列（当前停在区内的），events 只留通道穿越。 */
export function summarize(rows) {
  const ok = rows.filter(Boolean);
  const ob = ok.filter((r) => r.rsi6 && r.rsi6.state === 'overbought').sort((a, b) => b.rsi6.value - a.rsi6.value);
  const os = ok.filter((r) => r.rsi6 && r.rsi6.state === 'oversold').sort((a, b) => a.rsi6.value - b.rsi6.value);
  const obReturn = ok.filter((r) => r.rsi6 && r.rsi6.cross === 'out_ob');
  const osReturn = ok.filter((r) => r.rsi6 && r.rsi6.cross === 'out_os');
  const events = ok.filter((r) => r.tunnels.some((t) => t.event));
  const newInto = ok.filter((r) => r.rsi6 && (r.rsi6.cross === 'into_ob' || r.rsi6.cross === 'into_os'));
  return { all: ok, overbought: ob, oversold: os, obReturn, osReturn, events, newInto };
}
