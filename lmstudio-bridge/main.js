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
  const TARGET_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0'];
  // Ngrok memakai beberapa TLD (app, dev, io, pizza, ...). Cocokkan semua
  // subdomainnya agar URL seperti *.ngrok-free.dev ikut dialihkan. Ini penyebab
  // error CORS paling umum: domain ngrok tidak cocok, fetch jatuh ke browser.
  const NGROK_RE = /(^|\.)ngrok(-free)?\.(app|dev|io|pizza|pro|page)$/;
  function isTargetHost(host) {
    host = (host || '').toLowerCase().replace(/:\d+$/, '');
    if (TARGET_HOSTS.includes(host)) return true;
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
    return isTargetHost(new URL(href).host);
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

  // Cegah double-patch bila script jalan lebih dari sekali.
  if (window.__bkbBridgePatched) return;
  window.__bkbBridgePatched = true;

  // --- Saluran port ke background ---
  let port = null;
  const registry = new Map(); // id -> { meta, controller, pending, done, _finish, _reject, _timer, _abortHandler }
  let counter = 0;

  function ensurePort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'bkb-lmstudio-bridge' });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => { port = null; });
    return port;
  }

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
    const port = ensurePort();
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
      const onAbort = () => sendReq(port, { cmd: 'abort', id });
      signal.addEventListener('abort', onAbort, { once: true });
      registry.get(id)._abortHandler = onAbort;
    }

    sendReq(port, { type: 'req', id, method, url: absUrl, headers, body: bodySpec });

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

  function sendReq(port, msg) { try { port.postMessage(msg); } catch {} }

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
    isTargetUrl: (u) => isTargetUrl(u),
    size: () => registry.size,
    refreshPort: ensurePort,
  };
})();
