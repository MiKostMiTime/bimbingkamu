// =========================================================
// BimbingKamu - LM Studio Bridge (relay, ISOLATED world)
// =========================================================
// Content script di dunia ISOLATED (default) yang MEMILIKI akses
// chrome.runtime. Tugasnya menjembatani main.js (MAIN world, tidak
// punya chrome.*) dengan background service worker.
//
// Alur:
//   main.js  --window.postMessage-->  relay.js  --chrome.runtime.connect-->
//   background.js  --port-->  relay.js  --window.postMessage-->  main.js
//
// Relay juga mengulang pemeriksaan target sebagai pertahanan berlapis,
// jadi pesan palsu dari halaman tidak bisa memakai izin http/https
// ekstensi untuk menjangkau host sembarangan.
// =========================================================
(function () {
  'use strict';

  const CHANNEL = '__bkbBridge';
  const TARGET_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  const PRIVATE_V4_RE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  const NGROK_RE = /(^|\.)ngrok(-free)?\.(app|dev|io|pizza|pro|page)$/;
  // localtunnel: *.loca.lt — pertahanan berlapis (relay mengulang deteksi target).
  const LOCA_LT_RE = /(^|\.)loca\.lt$/;

  function isTargetHost(host) {
    host = (host || '').toLowerCase();
    if (host.charAt(0) === '[') {
      const end = host.indexOf(']');
      if (end !== -1) host = host.slice(0, end + 1);
    } else {
      host = host.replace(/:\d+$/, '');
    }
    host = host.replace(/^\[|\]$/g, '');
    if (TARGET_HOSTS.includes(host)) return true;
    if (host.endsWith('.local')) return true;
    if (PRIVATE_V4_RE.test(host)) return true;
    if (NGROK_RE.test(host)) return true;
    if (LOCA_LT_RE.test(host)) return true;
    return false;
  }

  function isTargetUrl(url) {
    try { return isTargetHost(new URL(url).hostname); } catch { return false; }
  }

  function broadcast(msg) {
    try { window.postMessage(msg, '*'); } catch {}
  }

  let port = null;
  function ensurePort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'bkb-lmstudio-bridge' });
    port.onMessage.addListener((msg) => broadcast({ [CHANNEL]: true, kind: 'res', payload: msg }));
    port.onDisconnect.addListener(() => { port = null; });
    return port;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data[CHANNEL] !== true) return;

    // main.js menanyakan apakah relay sudah siap.
    if (data.kind === 'ping') {
      broadcast({ [CHANNEL]: true, kind: 'ready' });
      return;
    }

    if (data.kind === 'req') {
      if (typeof data.id !== 'string' || !data.id) return;
      if (!isTargetUrl(data.url)) {
        broadcast({
          [CHANNEL]: true,
          kind: 'res',
          payload: { type: 'error', id: data.id, message: 'Endpoint tidak diizinkan bridge.' },
        });
        return;
      }
      try {
        ensurePort().postMessage({
          type: 'req',
          id: data.id,
          method: data.method,
          url: data.url,
          headers: data.headers,
          body: data.body,
        });
      } catch (err) {
        broadcast({
          [CHANNEL]: true,
          kind: 'res',
          payload: { type: 'error', id: data.id, message: (err && err.message) || 'Relay gagal terhubung.' },
        });
      }
      return;
    }

    if (data.kind === 'abort' && port) {
      try { port.postMessage({ cmd: 'abort', id: data.id }); } catch {}
    }
  });

  // Beri tahu lebih awal; main.js juga mengirim ping sebagai cadangan
  // bila urutan injeksi membuat pesan ini terlewat.
  broadcast({ [CHANNEL]: true, kind: 'ready' });
})();
