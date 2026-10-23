/* sw.js — 앱 설치용 서비스 워커. 온라인이면 항상 새 파일을 쓰고, 오프라인일 때만 저장본을 씀. */
const VERSION = 'scancourse-1.0.3';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './config.js?v=1.0.3', './core.js?v=1.0.3', './app.js?v=1.0.3', './tess/tesseract.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 카카오·경로 서버 요청은 건드리지 않음
  // 글자 인식 엔진 파일(크고 안 바뀜): 저장본 우선
  if (url.pathname.includes('/tess/')) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  // 나머지: 네트워크 우선, 실패하면 저장본
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
});
