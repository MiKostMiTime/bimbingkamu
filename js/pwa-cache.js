// BimbingKamu — PWA CACHE LOGIC (murni, teruji di Node; dipakai sw.js sebagai ESM worker).
export const CACHE_VERSION = 'bimbingkamu-shell-v4';
export const OLD_CACHE_PREFIX = 'bimbingkamu-shell-';

export const PRECACHE_ASSETS = [
  './index.html',
  './css/styles.min.css',
  './js/app.bundle.js',
  './js/pwa.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-1024.png',
];

// Apakah URL aset milik app (same-origin / path relatif)?
export function isOwnAsset(url, origin) {
  const u = typeof url === 'string' ? url : (url && url.href) || '';
  if (!u) return false;
  try {
    const base = new URL(origin);
    return new URL(u, origin).origin === base.origin;
  } catch {
    return true; // origin invalid → anggap path relatif (same-origin)
  }
}

export function selectStrategy(url, origin) {
  const u = typeof url === 'string' ? url : (url && url.href) || '';
  if (/\/sw\.js(\?|#|$)/.test(u)) return 'network-only'; // SW sendiri → selalu network
  if (isOwnAsset(u, origin)) return 'cache-first';        // aset lokal → offline-ready
  return 'network-first';                                 // API endpoint provider → network
}
