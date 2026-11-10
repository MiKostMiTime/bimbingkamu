// =========================================================
// BimbingKamu — /api/proxy  (Vercel serverless, ESM)
// Proksi endpoint model provider dari SISI SERVER agar lolos
// CORS & Private Network Access (PNA) di browser.
//
// Aplikasi memanggil:
//   POST /api/proxy  body: { url, method, headers: [[k,v]], body? }
//   (format lama tetap didukung: GET /api/proxy?url=&method=&headers=&body=)
// -> server-side fetch() ke target, kembalikan envelope JSON:
//      { status, ok, proxyStatus:'ok'|'threw', err?, headers, body }
//
// Kenapa ini solusi PNA: browser (halaman HTTPS di Vercel) yang
// memanggil endpoint publik/ngrok dibatasi PNA + CORS. Fetch dari
// sisi server (Vercel function) TIDAK terkena batasan browser itu,
// jadi respons bisa dikembalikan utuh ke aplikasi — TANPA ekstensi
// dan TANPA user harus mengaktifkan ACPNT/CORS di tunnel-nya.
// =========================================================

function headersToPairs(headers) {
  const out = [];
  if (!headers) return out;
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (Array.isArray(pair) && pair.length >= 2) out.push([String(pair[0]), String(pair[1])]);
    }
  } else if (typeof headers.forEach === 'function') {
    headers.forEach((v, k) => out.push([k, v]));
  } else if (typeof headers === 'object') {
    for (const k of Object.keys(headers)) out.push([k, String(headers[k])]);
  }
  return out;
}

// Baca body request (Node IncomingMessage: iterable). Aman bila kosong.
async function readBody(req) {
  // Vercel runtime kadang sudah menyediakan req.body string.
  if (typeof req.body === 'string' && req.body !== '') return req.body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (!chunks.length) return typeof req.body === 'string' ? req.body : '';
    const buf = Buffer.isBuffer(chunks[0])
      ? Buffer.concat(chunks)
      : Buffer.from(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return buf.toString('utf8');
  } catch {
    return typeof req.body === 'string' ? req.body : '';
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=0, must-revalidate',
    // Proksi same-origin ke aplikasi; buka lebar agar SPA bisa membacanya.
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

export default async function handler(req, res) {
  // Parse URL FIRST: `params` dipakai di baris method (atas), jadi harus dideklarasikan
  // sebelum dipakai. Tanpa ini -> ReferenceError 'Cannot access params before
  // initialization' (temporal dead zone) di setiap pemanggilan → 500 FUNCTION_INVOCATION_FAILED.
  let q;
  try { q = new URL(req.url, 'https://proxy'); } catch { q = new URL('/api/proxy', 'https://proxy'); }
  const params = q.searchParams;

  // Body request: klien baru mengirim envelope JSON di body (POST) agar body
  // chat + materi yang besar tidak menjadi query string panjang (414).
  let reqBody = '';
  try { reqBody = await readBody(req); } catch {}
  let envelope = null;
  if (reqBody && reqBody.trim().startsWith('{')) {
    try { envelope = JSON.parse(reqBody); } catch { envelope = null; }
  }

  const method = String(
    (envelope && envelope.method) || params.get('method') || req.method || 'GET'
  ).toUpperCase();

  // URL dari envelope (sudah polos) atau query (URLSearchParams sudah
  // men-decode; decodeURIComponent hanya untuk kompatibilitas klien lama).
  let target = (envelope && envelope.url) || params.get('url') || '';
  if (target && !envelope) {
    try { target = decodeURIComponent(target); } catch {}
  }
  if (!target) {
    return sendJson(res, 400, { status: 400, ok: false, proxyStatus: 'badrequest', err: 'Missing url parameter' });
  }

  // Bangun init fetch server-side. Header HARUS diteruskan utuh: endpoint
  // OpenAI-compatible menolak POST tanpa Content-Type (415) dan endpoint
  // ber-key menolak tanpa Authorization (401).
  let init = { method, redirect: 'follow' };
  let headerSpec = envelope ? envelope.headers : null;
  if (headerSpec == null) {
    try { headerSpec = JSON.parse(params.get('headers') || 'null'); } catch {}
  }
  const headerPairs = headersToPairs(headerSpec);
  if (headerPairs.length) init.headers = headerPairs;

  // Body: prioritas envelope (klien baru), lalu query body, lalu body request
  // mentah (klien lama yang mem-POST langsung ke proksi).
  if (envelope && envelope.body != null) {
    init.body = typeof envelope.body === 'string' ? envelope.body : JSON.stringify(envelope.body);
  } else {
    const qbody = params.get('body');
    if (qbody != null && qbody !== '') init.body = qbody;
    else if (!envelope && reqBody !== '') init.body = reqBody;
  }

  // Timeout internal (~120s, bisa diatur via ?timeoutMs=). Melindungi dari
  // endpoint yang menggantung agar proksi tak pernah memakan waktu lebih lama
  // dari batas serverless Vercel. AbortController dipakai juga agar body
  // upstream (text()/stream read()) bisa dibatalkan saat timeout.
  const TIMEOUT_MS = Number(params.get('timeoutMs')) || 120000;
  let timedOut = false;
  const acT = new AbortController();
  let timerT = setTimeout(() => { timedOut = true; acT.abort(); }, TIMEOUT_MS);

  // Jejak apakah stream sudah mulai ditulis (writeHead+write). Bila ya, error
  // tak bisa balik envelope (header sudah terkirim) → akhiri saja stream-nya.
  let piped = false;
  try {
    const net = await fetch(target, { ...init, signal: acT.signal });

    // Deteksi target streaming dari content-type upstream. Chat streaming
    // (OpenAI-compatible / LM Studio) membalas text/event-stream; deteksi ini
    // membuat proksi mengalirkan UTUH (passthrough) TANPA dibuffer ke envelope,
    // jadi delta muncul LIVE + tak terbatas 60s serverless.
    const ct = typeof net.headers.get === 'function'
      ? net.headers.get('content-type') || ''
      : '';
    const isStream = /text\/event-stream|application\/x-ndjson/i.test(ct);

    if (isStream) {
      res.writeHead(net.status, {
        'content-type': ct || 'text/event-stream',
        'cache-control': 'no-cache',
        'access-control-allow-origin': '*',
      });
      piped = true;
      const reader = net.body.getReader();
      for (;;) {
        if (acT.signal.aborted) break; // timeout → hentikan aliran
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.isBuffer(value) ? value : Buffer.from(value));
      }
      clearTimeout(timerT);
      res.end();
      return;
    }

    // Jalur envelope (non-stream, mis. GET /models): buffer utuh → JSON.
    const text = await net.text();
    const headers = {};
    if (net.headers && typeof net.headers.forEach === 'function') {
      net.headers.forEach((v, k) => { headers[k] = v; });
    } else if (net.headers) {
      for (const [k, v] of Object.entries(net.headers || {})) headers[k] = v;
    }
    clearTimeout(timerT);
    return sendJson(res, 200, {
      status: net.status,
      ok: net.ok,
      proxyStatus: 'ok',
      headers,
      body: text,
    });
  } catch (e) {
    clearTimeout(timerT);
    if (piped) { try { res.end(); } catch {} return; } // stream sudah mulai → tak bisa envelope
    const msg = String((e && e.message) || e);
    return sendJson(res, 200, {
      status: 0, ok: false,
      proxyStatus: timedOut ? 'timeout' : 'threw',
      err: msg, body: '',
    });
  }
}
