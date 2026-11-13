// =========================================================
// BimbingKamu — /api/proxy  (Cloudflare Pages Function, ESM)
// Proksi endpoint model provider dari SISI SERVER agar lolos
// CORS & Private Network Access (PNA) di browser.
//
// Aplikasi memanggil:
//   POST /api/proxy  body: { url, method, headers: [[k,v]], body? }
//   (format lama tetap didukung: GET /api/proxy?url=&method=&headers=&body=)
// -> server-side fetch() ke target, kembalikan:
//   (a) target streaming (text/event-stream | x-ndjson) → PASSTHROUGH utuh;
//   (b) selain itu → envelope JSON { status, ok, proxyStatus, err?, headers, body }.
//
// Catatan Cloudflare Pages: function di functions/api/proxy.js otomatis
// menangani rute /api/proxy SEBELUM aset statis (filesystem-first), jadi
// tidak ada rewrite yang bisa menelan POST (root cause 501 pada audit P0-1).
//
// Inti handler berbasis web-standard — Request → Response (bukan (req,res)
// Node) — agar bisa diuji langsung di Node 18+ (undici) dengan fetch global
// yang di-mock.
// =========================================================

// ===== SSRF GUARD =====
// Proksi menerima `url` dari klien. Tanpa guard, server bisa diarahkan ke
// metadata cloud (169.254.169.254), loopback, IP privat, atau skema berbahaya.
// Allowlist: hanya http(s) + hostname publik (bukan IP privat/loopback/link-local).
export function isAllowedTarget(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = (u.hostname || '').toLowerCase();
  if (!host) return false;
  // IPv6 literal: buang bracket.
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  // Loopback / any / metadata.
  if (bare === 'localhost' || bare === '0.0.0.0' || bare === '::' || bare === '::1' || bare === '[::1]') return false;
  if (bare.endsWith('.localhost') || bare.endsWith('.local') || bare.endsWith('.internal')) return false;
  // IPv4 privat/loopback/link-local/CGNAT.
  const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  // IPv6: apa pun yang dimulai fe80 (link-local), fc/fd (ULA), ::1, :: → tolak.
  if (bare.includes(':')) {
    const h = bare.toLowerCase();
    if (h === '::1' || h === '::') return false;
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return false;
    // IPv4-mapped/compatible (::ffff:127.0.0.1, ::ffff:a9fe:a9fe = 169.254.169.254,
    // 0:0:0:0:0:ffff:7f00:1) → loopback/metadata lewat IPv6. URL parser sudah
    // menormalkan desimal/hex IPv4, tapi TIDAK memetakan balik bentuk IPv6 ini.
    if (/^::ffff:/.test(h) || /^0:0:0:0:0:ffff:/.test(h)) return false;
    if (h.startsWith('64:ff9b:')) return false; // NAT64 well-known prefix
  }
  // Metadata cloud (AWS/GCP/Azure) walau bentuknya nama host.
  if (bare === 'metadata.google.internal' || bare === 'metadata.goog') return false;
  return true;
}

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

// Envelope JSON balasan non-stream. Method dipakai target, tapi status HTTP
// yang dikirim ke klien selalu 200 agar body envelope terbaca lewat CORS biasa.
// ===== KEBIJAKAN HOST =====
// Dulu proksi dibatasi allowlist host provider AI hardcode (audit H-1). Itu
// mematikan endpoint BYOK di luar daftar — termasuk tunnel HTTPS milik user
// (ngrok/localtunnel/trycloudflare) dan VPS sendiri — karena proksi satu-satunya
// jalur yang lolos CORS/PNA, sehingga semua endpoint itu selalu gagal.
// Kini kebijakannya SAMA dengan /api/fetch: host publik apa pun boleh.
//
// Batas keamanan = SSRF guard isAllowedTarget: bentuk literal loopback/IP
// privat/link-local/metadata (termasuk desimal/hex/oktal & IPv4-mapped IPv6,
// yang dinormalkan URL parser) DITOLAK. Catatan jujur: resolusi DNS TIDAK
// divalidasi (hostname yang mengarah ke IP privat tetap lolos) — sama seperti
// /api/fetch sebelum perubahan ini. Menutup celah itu butuh resolusi DNS per
// panggilan (biaya latensi + dependensi eksternal) dan di luar lingkup fix ini.
function jsonEnvelope(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

// Cap timeout (detik serverless/edge masing-masing platform beda; cap memberi
// batas atas wajar & cegah ?timeoutMs=999999999 untuk menahan worker lama).
export const MAX_TIMEOUT_MS = 60000;
export const DEFAULT_TIMEOUT_MS = 55000;

// Murni: clamp nilai ?timeoutMs ke [1, MAX]; bila kosong/invalid → DEFAULT.
export function clampTimeout(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(n, MAX_TIMEOUT_MS);
}

export async function proxyCore(request, fetchImpl = fetch) {
  // Parse query: timeoutMs (capped), format lama url/method/headers/body.
  const q = new URL(request.url);
  const TIMEOUT_MS = clampTimeout(q.searchParams.get('timeoutMs'));

  // Body request: envelope JSON (klien baru) atau format query lama.
  let reqBody = '';
  try {
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
      reqBody = await request.text();
    }
  } catch { reqBody = ''; }
  let envelope = null;
  if (reqBody && reqBody.trim().startsWith('{')) {
    try { envelope = JSON.parse(reqBody); } catch { envelope = null; }
  }

  const method = String(
    (envelope && envelope.method) || q.searchParams.get('method') || request.method || 'GET'
  ).toUpperCase();

  let target = (envelope && envelope.url) || q.searchParams.get('url') || '';
  if (target && !envelope) {
    try { target = decodeURIComponent(target); } catch {}
  }
  if (!target) {
    return jsonEnvelope({ status: 400, ok: false, proxyStatus: 'badrequest', err: 'Missing url parameter' });
  }
  // SSRF guard: tolak bentuk literal privat/loopback/metadata SEBELUM fetch.
  // Ini batas keamanan proksi (host publik apa pun boleh, seperti /api/fetch).
  if (!isAllowedTarget(target)) {
    return jsonEnvelope({ status: 403, ok: false, proxyStatus: 'forbidden', err: 'Target tidak diizinkan (privat/loopback/metadata/non-http).' });
  }

  let headerSpec = envelope ? envelope.headers : null;
  if (headerSpec == null) {
    try { headerSpec = JSON.parse(q.searchParams.get('headers') || 'null'); } catch {}
  }
  const headerPairs = headersToPairs(headerSpec);

  let body;
  if (envelope && envelope.body != null) {
    body = typeof envelope.body === 'string' ? envelope.body : JSON.stringify(envelope.body);
  } else {
    const qbody = q.searchParams.get('body');
    if (qbody != null && qbody !== '') body = qbody;
    else if (!envelope && reqBody !== '') body = reqBody;
  }

  let timedOut = false;
  const acT = new AbortController();
  const timerT = setTimeout(() => { timedOut = true; acT.abort(); }, TIMEOUT_MS);

  try {
    // Redirect diikuti MANUAL maks 4 hop: `redirect:'follow'` membuka bypass
    // SSRF (URL publik → 302 ke 169.254.169.254/loopback). Tiap hop divalidasi
    // ulang; kredensial dibuang bila origin berubah.
    const SENSITIVE_HDR = /^(authorization|cookie|proxy-authorization|x-api-key|api-key)$/i;
    let hopUrl = target;
    let hopMethod = method;
    let hopBody = body;
    let hopHeaders = headerPairs;
    let net;
    for (let hop = 0; hop < 4; hop++) {
      if (!isAllowedTarget(hopUrl)) {
        clearTimeout(timerT);
        return jsonEnvelope({ status: 403, ok: false, proxyStatus: 'forbidden', err: 'Redirect ke target privat/loopback/metadata ditolak.' });
      }
      const init = { method: hopMethod, redirect: 'manual', signal: acT.signal };
      if (hopHeaders.length) init.headers = hopHeaders;
      if (hopBody != null) init.body = hopBody;

      net = await fetchImpl(hopUrl, init);

      const loc = net.status >= 300 && net.status < 400 && net.status !== 304
        ? (net.headers.get('location') || '')
        : '';
      if (!loc) break;
      const nextUrl = new URL(loc, hopUrl);
      if (nextUrl.origin !== new URL(hopUrl).origin) {
        hopHeaders = hopHeaders.filter(([k]) => !SENSITIVE_HDR.test(k));
      }
      // 303 / POST 301-302 → GET tanpa body (semantik HTTP).
      if (net.status === 303 || ((net.status === 301 || net.status === 302) && hopMethod === 'POST')) {
        hopMethod = 'GET';
        hopBody = null;
      }
      hopUrl = nextUrl.href;
    }

    // Deteksi target streaming dari content-type → passthrough utuh (SSE live).
    const ct = typeof net.headers.get === 'function'
      ? net.headers.get('content-type') || ''
      : '';
    const isStream = /text\/event-stream|application\/x-ndjson/i.test(ct);

    if (isStream) {
      const headers = new Headers({
        'content-type': ct || 'text/event-stream',
        'cache-control': 'no-cache',
        'access-control-allow-origin': '*',
      });
      // Passthrough: kembalikan body upstream apa adanya (streaming live).
      // Timer dihentikan SETELAH header diterima — timeout di sini menjaga
      // "upstream tak pernah menjawab", bukan membatasi durasi jawaban panjang
      // (stream >55s normal untuk jawaban panjang; edge/browser yang memutus).
      clearTimeout(timerT);
      return new Response(net.body, { status: net.status, headers });
    }

    // Jalur envelope (non-stream, mis. GET /models): buffer → JSON.
    const text = await net.text();
    const headers = {};
    if (net.headers && typeof net.headers.forEach === 'function') {
      net.headers.forEach((v, k) => { headers[k] = v; });
    } else if (net.headers) {
      for (const [k, v] of Object.entries(net.headers || {})) headers[k] = v;
    }
    // Audit L-3: buang header sensitif upstream agar tidak diteruskan ke klien.
    for (const k of Object.keys(headers)) {
      if (/^(set-cookie|cookie|authorization|proxy-authorization)$/i.test(k)) delete headers[k];
    }
    clearTimeout(timerT);
    return jsonEnvelope({
      status: net.status,
      ok: net.ok,
      proxyStatus: 'ok',
      headers,
      body: text,
    });
  } catch (e) {
    clearTimeout(timerT);
    // Audit L-1: pesan exception internal tidak di-echo ke klien — cukup kode
    // generik. Detail tetap tersedia via console untuk debugging operator.
    console.error('[proxy] upstream error:', e && e.message ? e.message : e);
    return jsonEnvelope({
      status: 0, ok: false,
      proxyStatus: timedOut ? 'timeout' : 'threw',
      err: timedOut ? 'timeout' : 'upstream-error',
    });
  }
}

// ===== Pages Function entry points =====
// Cloudflare Pages memanggil onRequestGet/onRequestPost (dll.) otomatis untuk
// rute /api/proxy. Method lain diteruskan juga agar proksi tetap generik.
export const onRequestGet = ({ request }) => proxyCore(request);
export const onRequestPost = ({ request }) => proxyCore(request);
export const onRequestPut = ({ request }) => proxyCore(request);
export const onRequestPatch = ({ request }) => proxyCore(request);
export const onRequestDelete = ({ request }) => proxyCore(request);

// OPTIONS (preflight) dibalas ringkas tanpa menyentuh target.
export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400',
    },
  });
}
