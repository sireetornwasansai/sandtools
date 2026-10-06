/* SAND Office Tools service worker — offline support for the client-side tools.
 * The cache version and precache list below are filled in at build time by scripts/build.mjs.
 * It only ever caches same-origin static files. Requests to Google/GAS are never intercepted or stored. */
const CACHE = 'sand-__CACHE_VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sand-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin traffic
  if (url.pathname.startsWith('/s/') || url.pathname.startsWith('/api/')) return; // short-link redirects and edge functions always go to the network
  if (url.pathname.endsWith('/config.js')) { // runtime config: network first so changes apply, cache as offline fallback
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
