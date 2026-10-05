#!/usr/bin/env node
/* check-fresh.mjs —— 报告新鲜度心跳（CI 每日跑）
 * 读 out/latest.json 的 meta.marketDate，与 ET 墙钟推算的最近已收盘交易日比较：
 * 落后 >1 个交易日（= 连续两个收盘日没有新报告）→ 非 0 退出，触发 workflow 的失败告警。
 * 用法：node tools/check-fresh.mjs [path/to/latest.json]（默认 out/latest.json） */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastClosedDate, tradingDaysBetween } from '../lib/market.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(HERE, '..', process.argv[2] || path.join('out', 'latest.json'));

let meta = null;
try { meta = JSON.parse(readFileSync(file, 'utf8')).meta; } catch { /* 下面统一报错 */ }
if (!meta || !meta.marketDate) {
  console.error(`✗ 心跳：${path.relative(process.cwd(), file)} 缺失或无 meta.marketDate —— 报告从未生成或文件被破坏`);
  process.exit(1);
}
const expect = lastClosedDate();
const lag = tradingDaysBetween(meta.marketDate, expect);
if (lag > 1) {
  console.error(`✗ 心跳：报告停留在 ${meta.marketDate}，落后最近收盘日 ${expect} 共 ${lag} 个交易日 —— 连续无新报告，检查 us-monitor workflow`);
  process.exit(1);
}
console.log(`✓ 心跳：报告 ${meta.marketDate}（最近收盘日 ${expect}，落后 ${lag} 个交易日）`);
