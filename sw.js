/*
 * 공모 한눈에 — 서비스워커
 * 앱 셸은 캐시 우선(빠른 실행·오프라인), 데이터(programs.json)는 네트워크 우선
 * (항상 최신, 오프라인 시 캐시 폴백). 캐시 버전을 올리면 구버전은 정리된다.
 */
const CACHE = 'gongmo-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 외부 링크(공고 등)는 건드리지 않음

  // 데이터: 네트워크 우선 → 성공 시 캐시 갱신, 실패 시 캐시
  if (url.pathname.endsWith('programs.json')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 앱 셸/정적: 캐시 우선 → 없으면 네트워크 후 캐시. 네비게이션 실패 시 index로 폴백
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('/index.html') : undefined))
    )
  );
});
