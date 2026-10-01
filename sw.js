/* 美股监控 PWA Service Worker
   报告页(=当日数据)网络优先，断网回退到最近一份；其余同源静态资源缓存优先后台更新。
   改任何被缓存文件的内容时把 VER 号 +1，否则老客户端不更新。 */
const VER = 'usmon-1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/pwa/icon-192.png',
  './assets/pwa/icon-512.png',
  './assets/pwa/maskable-512.png',
  './assets/pwa/apple-touch-icon.png',
];
const HTML_RE = /(^|\/)(index\.html|report\.html)$|\/out\/$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 池外标的的腾讯在线报价等跨域请求直连
  if (/\.apk$/.test(url.pathname)) return; // APK 下载直连网络（交给浏览器/下载管理器），不入缓存
  const isHtml = req.mode === 'navigate' || HTML_RE.test(url.pathname);
  if (isHtml) {
    // 报告页每天收盘后由 CI 重新生成：网络优先。用默认缓存模式吃 Pages 的 304 协商
    // （max-age=600 内的陈旧对日线数据无感）。非 200（如 Pages 换部署的瞬时 404/5xx）
    // 或断网时，回退 SW 缓存里的最近一份，绝不把 GitHub 的 404 页甩给用户
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VER).then((c) => c.put(req, copy));
            return res;
          }
          return caches.match(req, { ignoreSearch: true }).then((r) => r || res);
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./out/report.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VER).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
