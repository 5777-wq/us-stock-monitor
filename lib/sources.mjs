/* sources.mjs —— 行情数据层（零依赖，Node 20+）
 * 降级链与口径（沿用上层看板 js/sources/history.js 的实测结论）：
 *   1) 东财 push2his：fqt=2 后复权（乘性，含拆股+分红，信号口径最稳），lmt≤5000。
 *      本机 Node fetch 会被 WAF 掐（UND_ERR_SOCKET）→ 传输链 fetch → curl 子进程；
 *      连续失败达阈值即熔断（东财 WAF 会 IP 级拒连，越打越死），本轮换腾讯兜底。
 *   2) 腾讯 kline/kline：美股返回【不复权】价（实测 NVDA/NFLX 拆股缺口裸露），
 *      2000 根深度最好。仅作兜底，返回 adj='raw'，报表标注"不复权"。
 * 缓存：out/cache/<源>-<代码>.json，按日期去重合并；近期已有数据只增量拉 120 根，
 * 避免每次全量拉 2000 根大响应触发东财 WAF（实测"连续拉大响应→整段拒连"）。
 * 报价（qt.gtimg.cn，GBK）：中文名 + 总市值（f[45] 亿美元×1e8），用于市值排名。 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const NUM = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

/* ---------- 传输层（fetch 优先，curl 子进程兜底；统一返回 ArrayBuffer） ---------- */

async function viaFetch(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://gu.qq.com/' }, signal: ac.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.arrayBuffer();
  } finally { clearTimeout(timer); }
}

/* transports: 有序传输链，逐个试。返回 ArrayBuffer（GBK 场景由调用方解码） */
async function httpGet(url, { timeoutMs = 20000, transports = ['fetch', 'curl'] } = {}) {
  let lastErr = null;
  for (const t of transports) {
    try {
      if (t === 'curl') {
        return await new Promise((resolve, reject) => {
          execFile('curl', ['-s', '-S', '--compressed', '--http1.1', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', UA, url],
            { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
            (err, stdout) => (err ? reject(new Error('curl(' + (err.code || err.message) + ')')) : resolve(stdout)));
        });
      }
      return await viaFetch(url, timeoutMs);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all transports failed');
}

function decodeMaybeGBK(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { try { return new TextDecoder('gbk').decode(bytes); } catch { return Buffer.from(bytes).toString('latin1'); } }
}

/* ---------- 东财：secid 解析 + 后复权日K ---------- */

const EAST_HOSTS = ['https://push2his.eastmoney.com', 'https://push2delay.eastmoney.com'];
const eastState = { fails: 0, disabled: false, lastError: null, requests: 0 };
let lastEastAt = 0;

function eastNote(err) {
  eastState.fails += 1;
  eastState.lastError = String(err && err.message || err).slice(0, 160);
  if (eastState.fails >= 2) eastState.disabled = true;   // 熔断：本轮不再打东财
}
function eastOk() { eastState.requests += 1; return !eastState.disabled; }
export function eastStatus() { return { ...eastState }; }

/* 解析东财 kline 行 "date,open,close,high,low,vol[,amount]" → [date,o,c,h,l,v] */
function parseEast(jsonText) {
  const j = JSON.parse(jsonText);
  const d = j && j.data;
  const rows = (d && d.klines) || [];
  const bars = rows.map((s) => {
    const f = String(s).split(',');
    return [f[0], NUM(f[1]), NUM(f[2]), NUM(f[3]), NUM(f[4]), NUM(f[5])];
  }).filter((b) => b[0] && b[2] !== null && b[2] > 0);
  return { name: d && d.name || null, bars };
}

/* 逐个市场位试探（107=美股基金/Arca，106=纽交所，105=纳斯达克），返回即含全量 bars。
 * 只有网络级失败计入熔断；三个市场位都干净返回空 = 代码不认识，不算东财的错。 */
async function eastKline(ticker, lmt) {
  const code = String(ticker).toUpperCase().replace(/\./g, '_');
  let hardErr = null;
  for (const host of EAST_HOSTS) {
    for (const mkt of [107, 106, 105]) {
      if (!eastOk()) throw new Error('eastmoney 熔断中');
      // 东财 WAF 讨厌密集大响应：请求间保持间隔
      const gap = Date.now() - lastEastAt;
      if (gap < 350) await sleep(350 - gap);
      lastEastAt = Date.now();
      const url = host + '/api/qt/stock/kline/get?secid=' + mkt + '.' + code +
        '&klt=101&fqt=2&lmt=' + lmt + '&end=20500101' +
        '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57';
      try {
        const text = decodeMaybeGBK(await httpGet(url, { transports: ['fetch', 'curl'] }));
        const r = parseEast(text);
        if (r.bars.length) {
          eastState.fails = 0;
          return { secid: mkt + '.' + code, name: r.name, bars: r.bars };
        }
      } catch (e) { hardErr = e; }
    }
  }
  if (hardErr) eastNote(hardErr);
  return null;
}

/* ---------- 腾讯：报价（中文名/市值/完整代码）+ 不复权日K ---------- */

function parseQuotes(text) {
  const out = [];
  text.replace(/\r/g, '').split(';').forEach((line) => {
    const m = line.match(/v_([A-Za-z0-9._]+)="([^"]*)"/);
    if (!m) return;
    const f = m[2].split('~');
    if (f.length < 46 || !f[3]) return;
    const price = NUM(f[3]);
    if (price === null || price === 0) return;   // 0 价 = 上游故障行（同 tencent.js 守卫）
    out.push({
      query: m[1],
      code: (f[2] || '').trim(),                 // 完整代码，如 AAPL.OQ / BRK.B.N / SPMO.AM
      name: (f[1] || '').trim(),
      price,
      prevClose: NUM(f[4]),
      mcapUsd: NUM(f[45]) !== null ? NUM(f[45]) * 1e8 : null,   // f[45] 总市值（亿美元）×1e8
    });
  });
  return out;
}

export async function tencentQuotes(tickers, { batch = 60 } = {}) {
  const list = [];
  for (let i = 0; i < tickers.length; i += batch) {
    const chunk = tickers.slice(i, i + batch).map((t) => 'us' + String(t).toUpperCase());
    try {
      const raw = decodeMaybeGBK(await httpGet('https://qt.gtimg.cn/q=' + chunk.join(','), { transports: ['fetch', 'curl'] }));
      list.push(...parseQuotes(raw));
    } catch { /* 单批失败不致命 */ }
    if (i + batch < tickers.length) await sleep(120);
  }
  return list;
}

async function tencentKline(fullCode, lmt) {
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=' +
    encodeURIComponent([fullCode, 'day', '', '', lmt].join(','));
  const j = JSON.parse(decodeMaybeGBK(await httpGet(url, { transports: ['fetch', 'curl'] })));
  const node = j && j.data && (j.data[fullCode] || Object.values(j.data || {})[0]);
  const rows = (node && (node.day || node.qfqday)) || [];
  return rows.map((r) => [r[0], NUM(r[1]), NUM(r[2]), NUM(r[3]), NUM(r[4]), NUM(r[5])])
    .filter((b) => b[0] && b[2] !== null && b[2] > 0);
}

/* ---------- 缓存 ---------- */

function cachePath(cacheDir, key) { return path.join(cacheDir, key + '.json'); }

function loadCache(cacheDir, key) {
  try {
    const p = cachePath(cacheDir, key);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return null; }
}

function saveCache(cacheDir, key, obj) {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath(cacheDir, key), JSON.stringify({ ...obj, key, savedAt: new Date().toISOString() }));
  } catch { /* 缓存写失败不影响主流程 */ }
}

/* 按日期合并去重（新数据覆盖同日），按日期升序 */
export function mergeBars(oldBars, newBars) {
  const map = new Map();
  for (const b of (oldBars || [])) if (b && b[0]) map.set(b[0], b);
  for (const b of (newBars || [])) if (b && b[0]) map.set(b[0], b);
  return [...map.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const daysBetween = (d1, d2) => Math.round((Date.parse(d2) - Date.parse(d1)) / 86400000);

/* ---------- 单标的主入口 ---------- */

/* getSeries('AAPL') → {ticker, name, bars, adj:'hfq'|'raw', source:'eastmoney'|'tencent', fetched} | null
 * 策略：东财缓存近 10 天内有新 bar → 增量拉 120 根合并；否则拉 2000 根。
 * 东财熔断/失败 → 腾讯不复权兜底（独立缓存，不与后复权混存）。 */
export async function getSeries(ticker, { cacheDir, bootstrapLmt = 2000, refreshLmt = 120 } = {}) {
  const T = String(ticker).toUpperCase();

  if (!eastState.disabled) {
    const key = 'east-' + T.replace(/\./g, '_');
    const cached = loadCache(cacheDir, key);
    const fresh = cached && Array.isArray(cached.bars) && cached.bars.length &&
      daysBetween(cached.bars[cached.bars.length - 1][0], new Date().toISOString().slice(0, 10)) <= 10;
    try {
      const r = await eastKline(T, fresh ? refreshLmt : bootstrapLmt);
      if (r && r.bars.length) {
        const bars = mergeBars(cached && cached.bars, r.bars);
        saveCache(cacheDir, key, { ticker: T, secid: r.secid, adj: 'hfq', source: 'eastmoney', bars });
        return { ticker: T, name: r.name, bars, adj: 'hfq', source: 'eastmoney', fetched: fresh ? 'refresh' : 'bootstrap' };
      }
    } catch { /* 落到腾讯 */ }
  }

  // 腾讯兜底：报价解析完整代码（usAAPL → usAAPL.OQ），不复权
  const tKey = 'tx-' + T.replace(/\./g, '_');
  try {
    const codeMap = loadCache(cacheDir, 'code-map') || { map: {} };
    let full = codeMap.map[T] || null;
    if (!full) {
      const q = await tencentQuotes([T]);
      full = q.length && /\./.test(q[0].code) ? 'us' + q[0].code : null;
      if (full) { codeMap.map[T] = full; saveCache(cacheDir, 'code-map', { map: codeMap.map }); }
    }
    // 瞬时抖动重试一次（实测：全量跑 101 只时偶发单标的超时，重试即恢复）
    let bars = null;
    for (let i = 0; i < 2 && !(bars && bars.length); i++) {
      if (i) await sleep(800);
      try { bars = await tencentKline(full || 'us' + T, bootstrapLmt); } catch { bars = null; }
    }
    if (!bars || !bars.length) return null;
    const cached = loadCache(cacheDir, tKey);
    const merged = mergeBars(cached && cached.bars, bars);
    saveCache(cacheDir, tKey, { ticker: T, code: full, adj: 'raw', source: 'tencent', bars: merged });
    return { ticker: T, name: null, bars: merged, adj: 'raw', source: 'tencent', fetched: 'fallback' };
  } catch { return null; }
}
