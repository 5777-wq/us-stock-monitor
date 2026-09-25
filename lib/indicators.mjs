/* indicators.mjs —— 指标计算层（纯函数，无 DOM / 无网络 / 无副作用）
 * 口径与上层看板 js/technical.js 完全一致（已在其 _test 里对过账）：
 *   · EMA：种子 = 前 n 项 SMA，此后 ema = prev + (close - prev) * 2/(n+1)；
 *   · RSI：Wilder 平滑（与通达信 SMA(X,N,1)、TradingView RMA 同口径）。
 * Vegas 三通道：EMA(12/36) 短通道、EMA(144/169) 主通道（Vegas Tunnel 本体）、
 * EMA(576/676) 长通道。上下轨 = 两条 EMA 的 max/min（趋势向上时 144 在 169 上方，
 * 不固定谁是上轨，按当根比较取）。
 * 铁律：数据不足返回 null，绝不产出 NaN；只描述事实，不说"建议买卖"。 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clean = (arr) => (Array.isArray(arr) ? arr.filter(isNum) : []);

/* EMA 序列：与 closes 对齐，前 n-1 位为 null。closes 至少 n 项才有值。 */
export function emaSeries(closes, n) {
  const c = clean(closes);
  if (!Number.isFinite(n) || n < 1 || c.length < n) return c.map(() => null);
  const k = 2 / (n + 1);
  const out = new Array(c.length).fill(null);
  let seed = 0;
  for (let i = 0; i < n; i++) seed += c[i];
  let prev = seed / n;
  out[n - 1] = prev;
  for (let i = n; i < c.length; i++) {
    prev = prev + (c[i] - prev) * k;
    out[i] = prev;
  }
  return out;
}

/* RSI 序列（Wilder）：与 closes 对齐，前 n 位为 null。
 * 递推：首窗口 avgG/avgL = 前 n 个涨/跌幅的简单均值；
 * 此后 avg = (avg*(n-1) + 当期) / n。avgL=0 → 100，avgG=0 → 0。 */
export function rsiSeries(closes, n = 6) {
  const c = clean(closes);
  const out = new Array(c.length).fill(null);
  if (!Number.isFinite(n) || n < 1 || c.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / n, avgL = loss / n;
  out[n] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
    avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

/* 价格相对一条通道（两条 EMA 围成的带）的位置：
 *   above = 收盘在两线之上（趋势市多头侧）；below = 之下；inside = 带内。
 * prev 同法用前一根收盘判，供穿越事件判定。 */
export function tunnelPos(close, emaA, emaB) {
  if (!isNum(close) || !isNum(emaA) || !isNum(emaB)) return null;
  const hi = Math.max(emaA, emaB), lo = Math.min(emaA, emaB);
  if (close > hi) return 'above';
  if (close < lo) return 'below';
  return 'inside';
}

/* pos 上一根 → pos 本根 的事件名：null = 无事件 */
export function tunnelEvent(prevPos, pos) {
  if (!prevPos || !pos || prevPos === pos) return null;
  const rank = { below: 0, inside: 1, above: 2 };
  return rank[pos] > rank[prevPos]
    ? (pos === 'above' ? 'break_up' : 'reenter_up')
    : (pos === 'below' ? 'break_down' : 'reenter_down');
}

/* 一根通道的完整快照（末根 + 前根，供事件判定） */
export function tunnelSnap(closes, nA, nB) {
  const c = clean(closes);
  const eA = emaSeries(c, nA), eB = emaSeries(c, nB);
  const lastI = c.length - 1, prevI = lastI - 1;
  const last = { a: eA[lastI], b: eB[lastI], pos: tunnelPos(c[lastI], eA[lastI], eB[lastI]) };
  const prev = { a: eA[prevI], b: eB[prevI], pos: tunnelPos(c[prevI], eA[prevI], eB[prevI]) };
  if (!last.pos) return null;
  last.event = tunnelEvent(prev.pos, last.pos);
  last.widthPct = last.a !== null && last.b !== null && (last.a + last.b) / 2 !== 0
    ? Math.abs(last.a - last.b) / ((last.a + last.b) / 2) * 100
    : null;
  return last;
}

/* RSI 末值 + 前值 + 状态 + 穿越（阈值严格 > / <，与目标描述一致） */
export function rsiSnap(closes, n, ob, os) {
  const c = clean(closes);
  const seq = rsiSeries(c, n);
  const lastI = c.length - 1;
  const v = seq[lastI], prev = lastI >= 1 ? seq[lastI - 1] : null;
  if (!isNum(v)) return null;
  const state = v > ob ? 'overbought' : v < os ? 'oversold' : 'neutral';
  const prevState = isNum(prev) ? (prev > ob ? 'overbought' : prev < os ? 'oversold' : 'neutral') : null;
  const cross = prevState && prevState !== state
    ? (state === 'overbought' ? 'into_ob'
      : state === 'oversold' ? 'into_os'
        : prevState === 'overbought' ? 'out_ob' : 'out_os')
    : null;
  return { value: v, prev, state, prevState, cross };
}
