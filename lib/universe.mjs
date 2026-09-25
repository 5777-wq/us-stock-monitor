/* universe.mjs —— 监控池构建
 * 候选池（SP500 成分快照 ~130 只）→ 腾讯实时总市值重排 → 取前 topN(100)。
 * 成员资格看快照文件，排名看实时市值：前者防"漏"，后者防"序旧"。
 * SPMO 不参与排名，由 monitor 固定加入。 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tencentQuotes } from './sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadCandidates(file) {
  const p = file ? path.resolve(HERE, '..', file) : path.join(HERE, '..', 'data', 'sp500-candidates.json');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return { file: p, tickers: j.tickers.map(([t, n]) => ({ ticker: t, name: n })), meta: { asOf: j.asOf, note: j.note } };
}

/* 上层看板已采集的 SPMO 持仓（data/actors/etf.json，Invesco 官方披露快照，
 * 只展示前 ~40 大）。命中则给出权重%，用于报表"SPMO重合"列。读不到就静默跳过。 */
export function loadSpmoHoldings() {
  try {
    const p = path.join(HERE, '..', '..', 'data', 'actors', 'etf.json');
    if (!existsSync(p)) return { asOf: null, map: {} };
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const fund = (j.funds || []).find((f) => f.ticker === 'SPMO');
    const map = {};
    for (const h of (fund && fund.holdings) || []) {
      const t = String(h.ticker || '').toUpperCase();
      if (t) map[t] = typeof h.pct === 'number' ? h.pct : null;
    }
    return { asOf: fund && (fund.effectiveDate || j.asOf) || null, map };
  } catch { return { asOf: null, map: {} }; }
}

/* quotes: tencentQuotes 的返回。按实时市值降序排前 topN；
 * 市值缺失的排末尾（保持快照序），且打 warned 标记。 */
export function rankUniverse(candidates, quotes, topN) {
  // 用报价回显的查询键（usBRK.B → BRK.B）对齐，别用 code（BRK.B.N 按点切会错）
  const qmap = new Map();
  for (const q of quotes) {
    const key = String(q.query || '').replace(/^us/i, '').toUpperCase();
    if (key) qmap.set(key, q);
  }
  const rows = candidates.map((c, i) => {
    const q = qmap.get(c.ticker);
    return {
      ticker: c.ticker,
      name: (q && q.name) || c.name,
      mcapUsd: q ? q.mcapUsd : null,
      quotePrice: q ? q.price : null,
      staticIndex: i,
    };
  });
  rows.sort((a, b) => {
    const am = a.mcapUsd ?? -1, bm = b.mcapUsd ?? -1;
    if (am !== bm) return bm - am;
    return a.staticIndex - b.staticIndex;
  });
  return rows.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1, mcapMissing: r.mcapUsd === null }));
}

export async function buildUniverse({ topN, candidatesFile, quoteBatch }) {
  const candidates = loadCandidates(candidatesFile);
  // SPMO 一起报价：拿中文名 + 现价（后复权序列锚定用）
  const quotes = await tencentQuotes([...candidates.tickers.map((t) => t.ticker), 'SPMO'], { batch: quoteBatch || 60 });
  const spmoQuote = quotes.find((q) => String(q.query || '').toUpperCase() === 'USSPMO') || null;
  const universe = rankUniverse(candidates.tickers, quotes, topN);
  const spmo = loadSpmoHoldings();
  for (const r of universe) r.spmoPct = spmo.map[r.ticker] ?? null;
  return { universe, candidatesMeta: candidates.meta, spmoHoldings: spmo, spmoQuote };
}
