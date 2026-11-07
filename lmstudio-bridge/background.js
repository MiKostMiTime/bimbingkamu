// =========================================================
// BimbingKamu — LM Studio Bridge (background service worker)
// Menerima permintaan dari content script lewat port, lalu
// mengambilnya LANGSUNG ke endpoint (punya host_permissions).
// Karena berjalan di konteks extension, CORS & Private Network
// Access halaman TIDAK memblokir respons → LM Studio/Ollama
// yang tanpa header ACAO tetap bisa dibaca aplikasi.
//
// Protokol port (string <-> JSON):
//   req    -> start / chunk* / end        (sukses)
//   req    -> error                       (fetch/stream gagal)
//   abort  -> hentikan stream id itu
// =========================================================

const ports = new Set();
// id -> ReadableStreamDefaultController aktif (untuk abort mid-stream).
const activeControllers = new Map();

function pairsToHeaders(pairs) {
  const h = new Headers();
  for (const [k, v] of pairs || []) h.set(k, v);
  return h;
}

function headersToPairs(headers) {
  const out = [];
  if (!headers) return out;
  try { headers.forEach((v, k) => out.push([k, v])); } catch {}
  return out;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function decodeBody(spec) {
  if (!spec) return undefined;
  if (spec.kind === 'string') return spec.value;
  if (spec.kind === 'bytes') return b64ToBytes(spec.base64);
  return undefined;
}

function send(port, msg) {
  try { port.postMessage(msg); } catch {}
}

// Ambil reader dari respons & alirkan chunk-nya ke content script.
async function streamResponse(port, id, res) {
  // Metadata awal (status/ok/header) dikirim dulu agar aplikasi bisa
  // membaca res.ok & res.status seketika setelah fetch resolves.
  send(port, {
    type: 'start',
    id,
    status: res.status,
    ok: res.ok,
    statusText: res.statusText,
    headers: headersToPairs(res.headers),
  });

  // Respons tanpa body (mis. 204 dari OPTIONS preflight) -> langsung tutup.
  if (!res.body || typeof res.body.getReader !== 'function') {
    send(port, { type: 'end', id });
    activeControllers.delete(id);
    return;
  }

  const reader = res.body.getReader();
  activeControllers.set(id, reader);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const arr = value;
      let bin = '';
      // Pecah per 8KB agar postMessage tak terlalu besar.
      for (let i = 0; i < arr.length; i += 8192) {
        bin += String.fromCharCode.apply(null, arr.subarray(i, i + 8192));
      }
      send(port, { type: 'chunk', id, base64: btoa(bin) });
    }
    send(port, { type: 'end', id });
  } catch (err) {
    send(port, { type: 'error', id, message: (err && err.message) || 'Stream error' });
  } finally {
    activeControllers.delete(id);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'req') return;
    const { id, method, url, headers, body: bodySpec } = msg;

    // Tangkap abort dari aplikasi (tombol "Berhendi") untuk memutus stream.
    if (msg.type === 'abort' || msg.cmd === 'abort') {
      const reader = activeControllers.get(id);
      if (reader) {
        try { await reader.abort(); } catch {}
      }
      return;
    }

    try {
      const init = { method, headers: pairsToHeaders(headers), redirect: 'follow' };
      const decoded = await decodeBody(bodySpec);
      if (decoded !== undefined) init.body = decoded;

      let res;
      try {
        res = await fetch(url, init);
      } catch (err) {
        send(port, { type: 'error', id, message: (err && err.message) || 'Fetch gagal' });
        return;
      }

      await streamResponse(port, id, res);
    } catch (err) {
      send(port, { type: 'error', id, message: (err && err.message) || 'Error' });
    }
  });
});
