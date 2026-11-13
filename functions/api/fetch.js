// =========================================================
// BimbingKamu — /api/fetch  (Cloudflare Pages Function, ESM)
// Membaca satu halaman website lalu mengubahnya menjadi teks materi.
// Dipakai lampiran materi bertipe URL (bukan hanya .pdf/.docx).
//
//   GET /api/fetch?url=https://... → { ok, url, title, text, chars, truncated }
//
// Sama seperti /api/proxy: target wajib http(s) publik (SSRF guard dipakai
// ulang), redirect diikuti manual maksimal 4 hop dan divalidasi tiap hop.
// Halaman yang isinya dirender JavaScript tidak punya teks di HTML — kasus itu
// jujur dilaporkan sebagai "empty", bukan diisi tebakan.
// =========================================================
import { isAllowedTarget } from './proxy.js';

export const MAX_CHARS = 200000;
const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 4;
// Banyak situs menolak (403) User-Agent bot. Pakai UA browser biasa agar
// halaman publik bisa dibaca; tetap sopan (tanpa cookie/login pengguna).
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'user-agent': BROWSER_UA,
  'cache-control': 'no-cache',
  'upgrade-insecure-requests': '1',
};

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', middot: '·',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', deg: '°', times: '×', divide: '÷',
  frac12: '½', laquo: '«', raquo: '»',
};

function codePointToString(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePointToString(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePointToString(parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

// Ubah HTML menjadi teks yang enak dibaca model: buang skrip/gaya/navigasi,
// pertahankan <main>/<article> bila ada, jadikan tag blok sebagai baris baru.
export function extractReadableText(html, { maxChars = MAX_CHARS } = {}) {
  const src = String(html ?? '');
  const titleTag = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitle = src.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = decodeEntities((titleTag && titleTag[1]) || (ogTitle && ogTitle[1]) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  let body = src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template|canvas)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');

  const main = body.match(/<main\b[\s\S]*?<\/main>/i) || body.match(/<article\b[\s\S]*?<\/article>/i);
  if (main) body = main[0];

  const flattened = body
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(flattened)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line, i, arr) => line && line !== arr[i - 1])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const truncated = text.length > maxChars;
  return {
    title,
    text: truncated ? text.slice(0, maxChars).trimEnd() : text,
    truncated,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function onRequestGet({ request }) {
  let target = '';
  try {
    target = new URL(request.url).searchParams.get('url') || '';
  } catch {
    target = '';
  }
  if (!/^https?:\/\//i.test(target)) return json({ ok: false, error: 'bad-url' }, 400);
  if (!isAllowedTarget(target)) return json({ ok: false, error: 'forbidden' }, 403);

  let current = target;
  let res = null;
  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      if (!isAllowedTarget(current)) return json({ ok: false, error: 'forbidden' }, 403);
      res = await fetch(current, {
        redirect: 'manual',
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const location = res.status >= 300 && res.status < 400 && res.status !== 304
        ? res.headers.get('location')
        : '';
      if (!location) break;
      current = new URL(location, current).href;
    }
  } catch {
    return json({ ok: false, error: 'fetch-network' }, 502);
  }

  if (!res) return json({ ok: false, error: 'fetch-network' }, 502);
  if (!res.ok) {
    const blocked = res.status === 401 || res.status === 403 || res.status === 429 || res.status === 451;
    return json({ ok: false, error: blocked ? 'blocked' : 'fetch-status', status: res.status }, 502);
  }

  const type = (res.headers.get('content-type') || '').toLowerCase();
  const isHtml = type.includes('text/html') || type.includes('application/xhtml');
  const isPlain = type.startsWith('text/plain') || type.includes('application/json');
  if (!isHtml && !isPlain) return json({ ok: false, error: 'not-html' }, 415);

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return json({ ok: false, error: 'too-large' }, 413);

  const raw = await res.text();
  if (raw.length > MAX_BYTES) return json({ ok: false, error: 'too-large' }, 413);

  const page = isHtml
    ? extractReadableText(raw)
    : {
        title: '',
        text: raw.trim().slice(0, MAX_CHARS),
        truncated: raw.trim().length > MAX_CHARS,
      };

  if (!page.text) return json({ ok: false, error: 'empty' }, 422);

  return json({
    ok: true,
    url: current,
    title: page.title || hostnameOf(current) || current,
    text: page.text,
    chars: page.text.length,
    truncated: page.truncated,
  });
}
