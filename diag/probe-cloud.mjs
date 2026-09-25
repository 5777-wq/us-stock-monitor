/* diag/probe-cloud.mjs —— Actions 网络数据源可达性诊断（手动 workflow_dispatch 触发）
 * 逐个测：东财 push2his（fetch / curl）、Yahoo v8 chart（fetch / curl）、腾讯兜底。
 * 只打印状态与字节数，不写任何文件。 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pExecFile = promisify(execFile);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const viaFetch = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://gu.qq.com/' }, signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  return `http ${r.status}, ${t.length} bytes, head=${t.slice(0, 60).replace(/\s+/g, ' ')}`;
};
const viaCurl = async (url) => {
  try {
    const { stdout } = await pExecFile('curl', ['-s', '-S', '--compressed', '--http1.1', '--max-time', '20', '-A', UA, url], { encoding: 'utf8', maxBuffer: 64e6, timeout: 30000 });
    return `ok, ${stdout.length} bytes, head=${stdout.slice(0, 60).replace(/\s+/g, ' ')}`;
  } catch (e) { return 'curl fail: ' + String(e.message || e).slice(0, 100); }
};
const show = async (name, url, transports = ['fetch', 'curl']) => {
  const out = [];
  for (const t of transports) {
    try { out.push(`${t}: ${await (t === 'fetch' ? viaFetch(url) : viaCurl(url))}`); }
    catch (e) { out.push(`${t}: ERR ${String(e.cause ? e.cause.code || e.cause.message : e.message).slice(0, 90)}`); }
  }
  console.log(`[${name}]\n  ${out.join('\n  ')}`);
};

const east = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=107.SPMO&klt=101&fqt=2&lmt=30&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57';
const eastBig = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=107.SPMO&klt=101&fqt=2&lmt=2000&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57';
const yahoo = 'https://query1.finance.yahoo.com/v8/finance/chart/SPMO?range=1mo&interval=1d&includeAdjustedClose=true';
const yahooBig = 'https://query1.finance.yahoo.com/v8/finance/chart/SPMO?range=10y&interval=1d&includeAdjustedClose=true&events=div%2Csplit';
const tx = 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=' + encodeURIComponent('usSPMO.AM,day,,,30,');

await show('east 小请求 lmt=30', east);
await show('east 大请求 lmt=2000（全量 bootstrap 用）', eastBig);
await show('yahoo 小请求 1mo', yahoo);
await show('yahoo 大请求 10y（全量 bootstrap 用）', yahooBig);
await show('tencent 2000 根（对照）', 'https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=' + encodeURIComponent('usSPMO.AM,day,,,2000,'));
await show('tencent 30 根', tx);
