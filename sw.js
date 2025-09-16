// 端末ローカルのみで動く PWA 用の最小 SW（アプリシェルのみキャッシュ）
const CACHE = 'puzzlelab-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './puzzle.js',
  './manifest.webmanifest',
  './icons/192.png',
  './icons/512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // blob:, data:, chrome-extension: などは触らない
  if (url.startsWith('blob:') || url.startsWith('data:')) return;

  // アプリシェルのみ CacheFirst、それ以外はネット（GitHub Pagesなら静的のみ）
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});

