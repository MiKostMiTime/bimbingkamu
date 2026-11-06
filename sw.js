// TanyaBukan — SERVICE WORKER (ESM)
import { CACHE_VERSION, OLD_CACHE_PREFIX, PRECACHE_ASSETS, selectStrategy } from './js/pwa-cache.js';

const ORIGIN = self.location.origin;

async function precache(list) {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(list);
}

addEventListener('install', (event) => {
  event.waitUntil(precache(PRECACHE_ASSETS));
});

addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith(OLD_CACHE_PREFIX) && n !== CACHE_VERSION)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const strategy = selectStrategy(req.url, ORIGIN);
  if (strategy === 'network-only') return; // SW sendiri: biarkan network default

  event.respondWith(handleFetch(req, strategy));
});

async function handleFetch(req, strategy) {
  if (strategy === 'cache-first') {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    if (cached) {
      // background refresh: simpan versi terbaru tanpa memblokir respons ke pengguna
      fetch(req).then((res) => {
        if (res && res.status !== 0) cache.put(req, res.clone());
      }).catch(() => {});
      return cached;
    }
    try {
      const fetched = await fetch(req);
      // bila gagal total (offline), fallback ke app shell
      if (!fetched || fetched.type === 'error') {
        const idx = await cache.match('./index.html');
        return idx || Response.error();
      }
      return fetched;
    } catch {
      const idx = await cache.match('./index.html');
      return idx || Response.error();
    }
  }
  // network-first (API endpoint provider)
  try {
    const resp = await fetch(req);
    return resp;
  } catch {
    const idx = await caches.open(CACHE_VERSION).then((c) => c.match('./index.html'));
    return idx || Response.error();
  }
}
