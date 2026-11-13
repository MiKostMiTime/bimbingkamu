// BimbingKamu — PWA CLIENT
import { CACHE_VERSION } from './pwa-cache.js';

export function shouldPromptUpdate(swState) {
  // swState: { installing?, installed?, waiting?, activating? } (boolean-ish)
  return !!(swState && swState.waiting);
}

let installListenerReady = false;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // ?rev=<cacheVersion> memaksa browser menganggap SW sebagai registrasi baru,
  // sehingga memasang versi barui meski byte sw.js tidak berubah (hanya import-nya
  // yang berubah). CACHE_VERSION di pwa-cache.js juga dibump tiap kali isi aset
  // precache (CSS/JS) berubah, agar cache lama diganti cache segar.
  const reg = await navigator.serviceWorker.register('./sw.js?rev=' + CACHE_VERSION, {
    type: 'module',
  });
    // Deteksi update: saat SW baru terpasang & controller lama masih aktif → 'waiting'.
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          // Versi baru siap; controller akan switch saat reload → tampilkan prompt.
          showInstallPrompt();
        }
      });
    });
  } catch (err) {
    console.warn('[PWA] register Service Worker gagal:', err);
  }
}

let deferredPrompt = null;
function showInstallPrompt() {
  if (!('showPrompt' in (deferredPrompt || {}))) return;
  const btn = document.getElementById('installBtn');
  if (btn) btn.click();
}

// Optional: tangkap beforeinstallprompt untuk tombol Install eksplisit.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  registerServiceWorker();
}
