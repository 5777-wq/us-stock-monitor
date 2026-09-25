/* notify.mjs —— 可选信号推送（默认关闭，config.notify.enabled 打开）
 * 支持三通道（按配置可多开）：
 *   · Server酱（sctapi.ftqq.com/<KEY>.send，微信接收）
 *   · Bark（iOS，https://api.day.app/<key>/<title>/<body>）
 *   · Telegram Bot（sendMessage）
 * 只推"有内容"的日子（onlySignals=true 时无超买/超卖/事件则不发）。 */

import { execFile } from 'node:child_process';

const enc = encodeURIComponent;

function viaCurlPost(url, form) {
  return new Promise((resolve) => {
    const args = ['-s', '--max-time', '15', '-X', 'POST', url];
    for (const [k, v] of Object.entries(form || {})) args.push('--data-urlencode', `${k}=${v}`);
    execFile('curl', args, { windowsHide: true, timeout: 20000 }, () => resolve());
  });
}

async function post(url, bodyObj) {
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj), signal: AbortSignal.timeout(15000) });
  } catch {
    // fetch 被墙/失败时退 curl（本机实测对多数海外接口更通）
    try { await viaCurlPost(url, bodyObj); } catch { /* 推送失败不影响监控主流程 */ }
  }
}

export function composeMessage(data) {
  const { meta, spmo, summary } = data;
  const ls = (r) => `${r.ticker}(${r.rsi6 ? r.rsi6.value.toFixed(0) : '--'})`;
  const lines = [];
  lines.push(`SPMO 收盘 ${spmo ? spmo.close.toFixed(2) : '--'} · RSI6 ${spmo && spmo.rsi6 ? spmo.rsi6.value.toFixed(1) : '--'}`);
  if (summary.overbought.length) lines.push('【超买·做T观察】' + summary.overbought.map(ls).join(' '));
  if (summary.oversold.length) lines.push('【超卖·吸纳观察】' + summary.oversold.map(ls).join(' '));
  if (summary.events.length) lines.push('【今日事件】' + summary.events.map((r) => r.ticker).join(' '));
  if (!lines.length) lines.push('今日无信号');
  return { title: `美股监控 ${meta.marketDate}`, body: lines.join('\n') + `\n(${meta.generatedAtLocal})` };
}

export async function notifyIfEnabled(nc, data) {
  if (!nc || !nc.enabled) return;
  const { summary } = data;
  const hasSignal = summary.overbought.length || summary.oversold.length || summary.events.length;
  if (nc.onlySignals && !hasSignal) return;
  const { title, body } = composeMessage(data);
  const jobs = [];
  if (nc.serverchanSendkey) {
    jobs.push(post(`https://sctapi.ftqq.com/${nc.serverchanSendkey}.send`, { title, desp: body.replace(/\n/g, '\n\n') }));
  }
  if (nc.barkUrl) {
    jobs.push(post(nc.barkUrl.replace(/\/$/, '') + '/' + enc(title) + '/' + enc(body.slice(0, 180)), {}));
  }
  if (nc.telegramToken && nc.telegramChatId) {
    jobs.push(post(`https://api.telegram.org/bot${nc.telegramToken}/sendMessage`,
      { chat_id: nc.telegramChatId, text: `*${title}*\n${body}`, disable_notification: !hasSignal }));
  }
  await Promise.all(jobs);
}
