// =========================================================
// BimbingKamu — /api/search  (Cloudflare Pages Function, ESM)
// Pencarian web untuk tutor. Kunci Tavily HANYA ada di server
// (environment variable TAVILY_API_KEY) — browser tak pernah melihatnya.
//
//   GET  /api/search  → { ok, configured }   (cek kesiapan, tanpa kunci)
//   POST /api/search  { query } → { ok, query, results[] }
//
// Batas 5 hasil: cukup untuk menjawab materi SMA tanpa membanjiri konteks.
// Handler mengembalikan JSON polos; pemetaan pesan ramah ada di js/search.js.
// =========================================================

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
export const MAX_RESULTS = 5;
const MAX_QUERY = 300;
const MAX_TITLE = 160;
const MAX_CONTENT = 1200; // cukup untuk sitasi, bukan seluruh halaman
const TIMEOUT_MS = 8000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// Rapikan kueri: spasi berlebih dibuang, dipotong agar URL/kuota tetap wajar.
export function normalizeQuery(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
}

// Hanya URL http(s) yang dipakai; dedup per URL; isi dipangkas.
export function normalizeResults(rawResults, limit = MAX_RESULTS) {
  if (!Array.isArray(rawResults)) return [];
  const seen = new Set();
  const out = [];
  for (const r of rawResults) {
    if (!r || out.length >= limit) break;
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      url,
      title: String(r.title || url).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE),
      content: String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT),
      publishedDate:
        typeof r.published_date === 'string'
          ? r.published_date.slice(0, 10)
          : typeof r.publishedDate === 'string'
            ? r.publishedDate.slice(0, 10)
            : '',
    });
  }
  return out;
}

// GET tanpa kueri = pemeriksaan kesiapan. Tidak pernah membocorkan kunci.
export function onRequestGet({ env }) {
  return json({ ok: true, configured: Boolean(env && env.TAVILY_API_KEY) });
}

export async function onRequestPost({ request, env }) {
  const apiKey = env && env.TAVILY_API_KEY;
  if (!apiKey) return json({ ok: false, error: 'search-not-configured' }, 503);

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const query = normalizeQuery(payload && payload.query);
  if (!query) return json({ ok: false, error: 'empty-query' }, 400);

  let res;
  try {
    res = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        topic: 'general',
        search_depth: 'basic',
        max_results: MAX_RESULTS,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return json({ ok: false, error: 'search-network' }, 502);
  }

  if (!res.ok) {
    const error =
      res.status === 401 || res.status === 403
        ? 'search-auth'
        : res.status === 429
          ? 'search-quota'
          : 'search-upstream';
    return json({ ok: false, error }, res.status === 429 ? 429 : 502);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const results = normalizeResults(data && data.results);
  return json({ ok: true, query, results, count: results.length });
}
