// =========================================================
// BimbingKamu — SERVICE WORKER (ESM)
// =========================================================
// Entry point PWA: registerServiceWorker() di js/pwa.js memanggil
// './sw.js' sebagai { type: 'module' }. Logika cache-nya murni &
// teruji di Node, disimpan di js/pwa-cache.js dan diimpor ke sini.
//
// Strategi (lihat selectStrategy di pwa-cache.js):
//   - aset lokal (same-origin)  → cache-first  (offline-ready)
//   - API endpoint provider      → network-first (cache sebagai cadangan)
//   - sw.js sendiri              → network-only (selalu versi terbaru)
//   - navigasi SPA               → fallback ke index.html (Vercel rewrite)

import {
  CACHE_VERSION,
  OLD_CACHE_PREFIX,
  PRECACHE_ASSETS,
  selectStrategy,
} from './js/pwa-cache.js';

// Selesaikan path relatif (./index.html) ke URL absolut terhadap scope SW.
const toAbs = (asset) => new URL(asset, self.location.href).href;

// ===== INSTALL: precache app shell, langsung aktif =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      // addAll() tetap lanjut walau ada yang gagal; log saja agar mudah didiagnosa.
      try {
        await cache.addAll(PRECACHE_ASSETS.map(toAbs));
      } catch (err) {
        console.warn('[SW] precache sebagian gagal:', err);
      }
      // Ambil alih halaman lama langsung tanpa harus reload manual.
      await self.skipWaiting();
    }),
  );
});

// ===== ACTIVATE: bersihkan cache versi lama, kuasai client =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(OLD_CACHE_PREFIX) && key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      ),
    )
      .then(() => self.clients.claim())
      .catch((err) => console.warn('[SW] aktivasi/cleanup gagal:', err)),
  );
});

// ===== FETCH: arahkan per strategi aset =====
self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Hanya tangkap GET.
  if (request.mode !== 'navigate' && request.method !== 'GET') return;

  const strategy = selectStrategy(request.url, self.location.origin);

  // Navigasi SPA: coba jaringan, bila gagal/uneksklusif kembali ke shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const net = await fetch(request);
          // Vercel merewrite path tak dikenal ke index.html (status 200).
          // Kembalikan responnya apa adanya; bila jaringan drop, pakai shell.
          return net;
        } catch {
          const shell = await caches.match(toAbs('./index.html'));
          return shell || Response.redirect(self.location.href, 302);
        }
      })(),
    );
    return;
  }

  // Request aset / API biasa.
  if (strategy === 'network-only') {
    event.respondWith(fetch(request));
    return;
  }
  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(request));
    return;
  }
  // network-first (default) — untuk API endpoint provider.
  event.respondWith(networkFirst(request));
});

// Cache-first: pakai cache bila ada, bila tidak → jaringan + simpan ke cache.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const net = await fetch(request);
    // Simpan salinan agar bisa dibaca offline nanti.
    const copy = net.clone();
    // Bungkas simpan ke cache agar error write tak menggagalkan respons asli
    // (mencegah "Failed to convert value to 'Response'" di perangkat).
    try {
      await caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
    } catch (err) {
      console.warn('[SW] simpan cache gagal:', err);
    }
    return net;
  } catch {
    // Tanpa jaringan: tetap beri shell agar UI tetap tampil.
    // `await` wajib: caches.match() mengembalikan Promise yang bisa resolve ke
    // undefined. Tanpa await, respondWith() menerima Promise<undefined> dan
    // memicu "Failed to convert value to 'Response'".
    const shell = await caches.match(toAbs('./index.html'));
    return shell || Response.error();
  }
}

// Network-first: coba jaringan, bila gagal → pakai cache sebagai cadangan.
async function networkFirst(request) {
  try {
    const net = await fetch(request);
    const copy = net.clone();
    // Bungkas simpan ke cache agar error write tak menggagalkan respons asli.
    try {
      await caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
    } catch (err) {
      console.warn('[SW] simpan cache gagal:', err);
    }
    return net;
  } catch {
    // `await` wajib agar fallback benar-benar Response (cache miss = undefined).
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}
