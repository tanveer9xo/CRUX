// Offline-first service worker (same pattern as VANE): precache the whole app, serve it from the cache,
// swap versions atomically. Bump VERSION on every release, together with APP_VERSION in js/version.js
// (a test checks they match). The cache name changes with it, so every installed copy re-downloads the app.
const VERSION = '1.1.1';
const PREFIX = 'crux-';
const CACHE = `${PREFIX}${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/backup.js',
  './js/boot.js',
  './js/brand.js',
  './js/bills.js',
  './js/budget.js',
  './js/dates.js',
  './js/goals.js',
  './js/db.js',
  './js/insights.js',
  './js/money.js',
  './js/pwa.js',
  './js/router.js',
  './js/seed.js',
  './js/store.js',
  './js/ui.js',
  './js/version.js',
  './js/views/add.js',
  './js/views/billflow.js',
  './js/views/bills.js',
  './js/views/common.js',
  './js/views/goals.js',
  './js/views/history.js',
  './js/views/home.js',
  './js/views/insights.js',
  './js/views/plan.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache so a new version never precaches stale files.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Only CRUX's own old caches. VANE shares this origin and keeps its caches.
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over when the user taps "Update".
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Only GET requests on this origin AND inside /CRUX/ are handled; VANE's /VANE/ and anything else pass through.
const SCOPE_PATH = new URL(self.registration.scope).pathname;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

  if (req.mode === 'navigate') {
    // App shell: always the cached index.html (routing happens in the hash).
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('./index.html')) ?? fetch(req);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(req, { ignoreSearch: true })) ?? fetch(req);
  })());
});
