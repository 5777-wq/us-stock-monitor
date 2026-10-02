/* gen-icons.mjs —— 零依赖生成全部 App/PWA 图标（纯 Node 画像素 → PNG）
   图形：青绿渐变圆角底 + 三根白蜡烛（中间最高）。改形状/配色后 node tools/gen-icons.mjs 重新生成。 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- PNG 编码（8-bit RGBA，无滤波） ---------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 图形定义（单位坐标 0..1，字模组居中横跨 26%~74%） ---------- */
const TOP = [0x2b, 0x57, 0xe8], BOT = [0x06, 0x21, 0x8f], INK = [0xf2, 0xfb, 0xfa];
const RADIUS = 0.225; // 圆角半径（占边长比例）
const CANDLES = [ // 每根：body x0,x1,y0,y1 + wick x0,x1,y0,y1
  { bx0: 0.275, bx1: 0.385, by0: 0.44, by1: 0.72, wx0: 0.3225, wx1: 0.3375, wy0: 0.36, wy1: 0.79 },
  { bx0: 0.445, bx1: 0.555, by0: 0.26, by1: 0.6, wx0: 0.4925, wx1: 0.5075, wy0: 0.17, wy1: 0.68 },
  { bx0: 0.615, bx1: 0.725, by0: 0.5, by1: 0.76, wx0: 0.6625, wx1: 0.6775, wy0: 0.41, wy1: 0.84 },
];
const inRect = (u, v, x0, x1, y0, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
const inGlyph = (u, v) => CANDLES.some((c) => inRect(u, v, c.bx0, c.bx1, c.by0, c.by1) || inRect(u, v, c.wx0, c.wx1, c.wy0, c.wy1));
const inRounded = (u, v, r = RADIUS) => {
  const lo = r, hi = 1 - r;
  const dx = u < lo ? lo - u : u > hi ? u - hi : 0;
  const dy = v < lo ? lo - v : v > hi ? v - hi : 0;
  return dx * dx + dy * dy <= r * r;
};

/* rounded=true：渐变圆角底（桌面/经典启动器/PWA）；rounded=false：
   bg==='none' 透明底只留字模（自适应图标前景）；bg==='full' 满幅渐变底（maskable/苹果触摸图标）。
   k：字模组相对画布的缩放（maskable/前景留更多安全边距）。 */
function render(size, { rounded = true, bg = 'full', k = 1 }) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4, n = size * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x * SS + sx + 0.5) / n, v = (y * SS + sy + 0.5) / n;
          let ca = 255, cr, cg, cb;
          if (rounded) { ca = inRounded(u, v) ? 255 : 0; }
          if (ca) {
            const gu = (u - 0.5) / k + 0.5, gv = (v - 0.5) / k + 0.5;
            if (inGlyph(gu, gv)) { cr = INK[0]; cg = INK[1]; cb = INK[2]; }
            else if (bg === 'none') { ca = 0; }
            else { const t = v; cr = TOP[0] + (BOT[0] - TOP[0]) * t; cg = TOP[1] + (BOT[1] - TOP[1]) * t; cb = TOP[2] + (BOT[2] - TOP[2]) * t; }
          }
          if (ca) { r += cr; g += cg; b += cb; a += ca; }
        }
      }
      const cnt = SS * SS, i = (y * size + x) * 4;
      buf[i] = Math.round(r / cnt); buf[i + 1] = Math.round(g / cnt); buf[i + 2] = Math.round(b / cnt); buf[i + 3] = Math.round(a / cnt);
    }
  }
  return png(size, size, buf);
}

/* ---------- 输出清单 ---------- */
const specs = [
  // PWA（桌面安装弹窗 / 浏览器标签 / 苹果添加到主屏）
  { out: 'assets/pwa/icon-192.png', size: 192 },
  { out: 'assets/pwa/icon-512.png', size: 512 },
  { out: 'assets/pwa/maskable-512.png', size: 512, rounded: false, k: 0.8 },
  { out: 'assets/pwa/apple-touch-icon.png', size: 180, rounded: false, k: 0.92 },
  // 经典启动器图标（Android 7.x 直接用 PNG）
  ...[[48, 'mdpi'], [72, 'hdpi'], [96, 'xhdpi'], [144, 'xxhdpi'], [192, 'xxxhdpi']]
    .map(([s, d]) => ({ out: `android/app/src/main/res/mipmap-${d}/ic_launcher.png`, size: s })),
  // 自适应图标前景（Android 8+，透明底 + 居中缩小字模；背景色在 colors.xml）
  // k=0.8：蜡炷最远尖端距中心 0.293 < 安全区半径 0.305（33dp/108dp），任何遮罩都不裁
  ...[[108, 'mdpi'], [162, 'hdpi'], [216, 'xhdpi'], [324, 'xxhdpi'], [432, 'xxxhdpi']]
    .map(([s, d]) => ({ out: `android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, size: s, rounded: false, bg: 'none', k: 0.8 })),
];
for (const s of specs) {
  const p = join(ROOT, s.out);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, render(s.size, s));
  console.log('icon', s.out, `${s.size}x${s.size}`);
}
