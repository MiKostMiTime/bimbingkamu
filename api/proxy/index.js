// =========================================================
// BimbingKamu — /api/proxy  (Vercel serverless, ESM)
// Proksi endpoint model provider dari SISI SERVER agar lolos
// CORS & Private Network Access (PNA) di browser.
//
// Aplikasi memanggil:
//   GET/POST /api/proxy?url=<encoded-target>
//            &method=&headers=<json>&body=<json>
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
  try { headers.forEach((v, k) => out.push([k, v])); } catch {}
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
  const method = String(req.method || 'GET').toUpperCase();
  let q;
  try { q = new URL(req.url, 'https://proxy'); } catch { q = new URL('/api/proxy', 'https://proxy'); }
  const params = q.searchParams;

  const target = decodeURIComponent(params.get('url') || '');
  if (!target) {
    return sendJson(res, 400, { status: 400, ok: false, proxyStatus: 'badrequest', err: 'Missing url parameter' });
  }

  // Bangun init fetch server-side.
  let init = { method, redirect: 'follow' };
  try {
    const headers = JSON.parse(params.get('headers') || '{}');
    if (headers && typeof headers === 'object' && Object.keys(headers).length) init.headers = headers;
  } catch {}

  // Body: prioritas dari query body (dibawa aplikasi), lalu body request asli.
  let reqBody = '';
  try { reqBody = await readBody(req); } catch {}
  const qbody = params.get('body');
  if (qbody != null && qbody !== '') init.body = qbody;
  else if (reqBody != null && reqBody !== '') init.body = reqBody;

  try {
    const net = await fetch(target, init);
    const text = await net.text();
    const headers = {};
    if (net.headers && typeof net.headers.forEach === 'function') {
      net.headers.forEach((v, k) => { headers[k] = v; });
    } else if (net.headers) {
      for (const [k, v] of Object.entries(net.headers || {})) headers[k] = v;
    }
    return sendJson(res, 200, {
      status: net.status,
      ok: net.ok,
      proxyStatus: 'ok',
      headers,
      body: text,
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    return sendJson(res, 200, { status: 0, ok: false, proxyStatus: 'threw', err: msg, body: '' });
  }
}
