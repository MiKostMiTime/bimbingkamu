// =========================================================
// BimbingKamu — LM Studio Bridge (content script, MAIN world)
// Menimpa window.fetch agar permintaan ke endpoint lokal / ngrok
// (LM Studio / Ollama) dialihkan ke background service worker.
// Karena SW punya host_permissions & konteks sendiri, CORS &
// Private Network Access halaman tidak memblokir respons.
//
// Berjalan di MAIN world + document_start → menimpa fetch sebelum
// app.js menjalankan apapun, jadi SEMUA fetch aplikasi teralihkan.
// =========================================================
(function () {
  'use strict';

  // --- Target: endpoint mana saja yang dialihkan (bisa diedit) ---
  // Termasuk LAN IP (10.x, 172.16-31.x, 192.168.x), link-local, CGNAT
  // (100.64/10, dipakai Tailscale), IPv6 loopback, dan nama *.local.
  // Chrome match pattern tidak mendukung CIDR, jadi IP privat dideteksi
  // di sini, bukan lewat host_permissions.
  const TARGET_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  const PRIVATE_V4_RE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  // Ngrok memakai beberapa TLD (app, dev, io, pizza, ...). Cocokkan semua
  // subdomainnya agar URL seperti *.ngrok-free.dev ikut dialihkan. Ini penyebab
  // error CORS paling umum: domain ngrok tidak cocok, fetch jatuh ke browser.
  const NGROK_RE = /(^|\.)ngrok(-free)?\.(app|dev|io|pizza|pro|page)$/;
  function isTargetHost(host) {
    host = (host || '').toLowerCase();
    // Buang port, tetapi pertahankan kurung IPv6: [::1]:1234 -> [::1].
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
    return false;
  }
  function targetHref(input) {
    let str = typeof input === 'string' ? input : (input && input.href) || String(input);
    try { return new URL(str).href; } catch { return null; }
  }
  function isTargetUrl(input) {
    const href = targetHref(input);
    if (!href) return false;
    return isTargetHost(new URL(href).hostname);
  }

  // --- Ambil fetch asli halaman (lazy agar aman di document_start) ---
  let _origFetch = null;
  function getOrigFetch() {
    if (_origFetch) return _origFetch;
    const w = window;
    const base = w.fetch || function () {};
    _origFetch = base.bind(w);
    return _origFetch;
  }

  // Versi patch. Naikkan saat aturan target berubah, supaya salinan lama
  // (ekstensi dobel / belum di-reload) bisa dikenali dan digantikan.
  const VERSION = '1.2.0';

  // Cegah double-patch, TAPI izinkan versi ini menggantikan patch lama.
  // Ekstensi lama tidak boleh menang hanya karena menyuntik lebih dulu.
  if (window.__bkbBridgePatched === VERSION) return;
  window.__bkbBridgePatched = VERSION;

  // --- Saluran ke relay (ISOLATED world) lewat window.postMessage ---
  // MAIN world tidak punya chrome.runtime, jadi tidak boleh memanggil
  // chrome.runtime.connect() di sini. relay.js yang memegang port ke
  // background dan meneruskan pesan lewat postMessage.
  const CHANNEL = '__bkbBridge';
  const registry = new Map(); // id -> { meta, controller, pending, done, _finish, _reject, _timer, _abortHandler }
  let counter = 0;

  let relayReady = false;
  const outbox = [];
  let pingTimer = null;

  function rawPost(msg) {
    msg[CHANNEL] = true;
    try { window.postMessage(msg, '*'); } catch {}
  }

  function pingRelay() {
    if (relayReady || pingTimer) return;
    let tries = 0;
    pingTimer = setInterval(() => {
      rawPost({ kind: 'ping' });
      if (relayReady || ++tries >= 20) { clearInterval(pingTimer); pingTimer = null; }
    }, 250);
    rawPost({ kind: 'ping' });
  }

  function post(msg) {
    if (relayReady) { rawPost(msg); return; }
    // Relay mungkin belum siap (urutan injeksi). Simpan dulu, lalu kirim
    // setelah relay mengumumkan siap.
    if (outbox.length < 50) outbox.push(msg);
    pingRelay();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data[CHANNEL] !== true) return;
    if (data.kind === 'ready') {
      relayReady = true;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      const pending = outbox.splice(0);
      for (const msg of pending) rawPost(msg);
      return;
    }
    if (data.kind === 'res') onPortMessage(data.payload);
  });
  pingRelay();

  // --- Utilitas encode/decode base64 (UTF8-safe) ---
  function bytesToB64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < arr.length; i += 8192) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, i + 8192));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // --- Pesan dari background -> di sini ---
  function onPortMessage(msg) {
    const r = registry.get(msg.id);
    if (!r) return;
    switch (msg.type) {
      case 'start':
        r.meta = msg;
        if (r._timer) { clearTimeout(r._timer); r._timer = null; }
        if (r._finish) r._finish();
        break;
      case 'chunk': {
        const bytes = b64ToBytes(msg.base64);
        if (r.controller) { try { r.controller.enqueue(bytes); } catch {} }
        else { (r.pending = r.pending || []).push(bytes); }
        break;
      }
      case 'end':
        r.done = true;
        if (r.controller) { try { r.controller.close(); } catch {} }
        cleanup(r);
        break;
      case 'error':
        if (r.controller) { try { r.controller.error(new Error(msg.message || 'Proxy error')); } catch {} }
        else { r.error = msg.message; }
        cleanup(r);
        break;
    }
  }

  function cleanup(r) {
    if (r._timer) { clearTimeout(r._timer); r._timer = null; }
    const w = window;
    if (r._abortHandler && r.signal) r.signal.removeEventListener('abort', r._abortHandler);
    registry.delete(r.id);
  }

  // --- Bangun Response-like: text()/json() + streaming body.getReader() ---
  function buildResponse(id) {
    const r = registry.get(id);
    const meta = r.meta;
    let controllerRef = null;
    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        r.controller = controller;
        // Kirim chunk yang datang sebelum reader aktif.
        const pending = r.pending || [];
        for (const b of pending) { try { controller.enqueue(b); } catch {} }
        r.pending = null;
        if (r.done) { try { controller.close(); } catch {} }
      },
    });
    const headers = new Headers((meta.headers || []).map(([k, v]) => [k, v]));
    const response = {
      ok: meta.ok,
      status: meta.status,
      statusText: meta.statusText || '',
      headers,
      async text() {
        const reader = stream.getReader();
        const dec = new TextDecoder();
        let out = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out += dec.decode(value, { stream: true });
        }
        return out + dec.decode();
      },
      async json() { return JSON.parse(await response.text()); },
      get body() { return stream; },
    };
    return response;
  }

  // --- Ubah HeadersInit -> array [k, v] agar aman dilewatkan via pesan ---
  function toHeaderPairs(headers) {
    const pairs = [];
    if (!headers) return pairs;
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      headers.forEach((v, k) => pairs.push([k, v]));
    } else if (Array.isArray(headers)) {
      return headers.map(([k, v]) => [String(k), String(v)]);
    } else {
      for (const k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k)) pairs.push([k, String(headers[k])]);
      }
    }
    return pairs;
  }

  function encodeBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') return { kind: 'string', value: body };
    try {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
      return { kind: 'bytes', base64: bytesToB64(bytes) };
    } catch {
      return { kind: 'string', value: String(body) };
    }
  }

  // --- Inti: alihkan fetch target ke background ---
  function proxyFetch(input, init) {
    const id = 'px' + (++counter);
    const urlStr = typeof input === 'string' ? input : (input && input.href) || String(input);
    const absUrl = new URL(urlStr, window.location.href).href;
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const headers = toHeaderPairs((init && init.headers) || (input && input.headers));
    const bodySpec = encodeBody(
      (init && init.body) != null ? init.body : ((input && input.body != null) ? input.body : undefined)
    );
    const signal = (init && init.signal);

    registry.set(id, { id, meta: null, controller: null, pending: null, done: false, signal });

    // Dukungan abort (tombol "Berhendi"): kirim sinyal ke background.
    if (signal) {
      const onAbort = () => post({ kind: 'abort', id });
      signal.addEventListener('abort', onAbort, { once: true });
      registry.get(id)._abortHandler = onAbort;
    }

    post({ kind: 'req', id, method, url: absUrl, headers, body: bodySpec });

    return new Promise((resolve, reject) => {
      const r = registry.get(id);
      r._finish = () => {
        if (!r.meta) return;
        if (r._timer) { clearTimeout(r._timer); r._timer = null; }
        resolve(buildResponse(id));
      };
      r._reject = reject;
      // Timeout: background tak kunjung memberi start (~45s).
      r._timer = setTimeout(() => {
        if (r.meta) return;
        try { reject({ type: 'network', message: 'Waktu tunggu proxy habis — endpoint tidak merespons.' }); } catch {}
        cleanup(r);
      }, 45000);
    });
  }

  // --- Pasang patch ke window.fetch ---
  const originalFetch = getOrigFetch();
  window.fetch = function (input, init) {
    try {
      if (isTargetUrl(input)) return proxyFetch(input, init);
    } catch (e) { /* bila deteksi gagal → jalankan fetch biasa */ }
    return originalFetch.call(window, input, init);
  };
  window.fetch.__bkbBridge = true;

  // Helper debugging di console: __bkbBridgeDebug.isTargetUrl(url), .size()
  window.__bkbBridgeDebug = {
    version: VERSION,
    ngrok: String(NGROK_RE),
    private: String(PRIVATE_V4_RE),
    isTargetUrl: (u) => isTargetUrl(u),
    size: () => registry.size,
    relay: () => relayReady,
  };
})();
