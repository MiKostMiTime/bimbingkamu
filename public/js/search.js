// =========================================================
// BimbingKamu — PENCARIAN WEB (klien)
// Satu pintu ke Pages Function /api/search (Tavily di sisi server).
// Mode BYOK: siswa boleh menempel kunci Tavily sendiri; kunci disimpan di
// browser ini dan dipakai untuk memanggil Tavily langsung (fallback tanpa
// Functions) atau lewat server bila server punya kunci.
//
// Hasil disimpan di cache memori 10 menit: menekan "Regenerasi" tidak
// membayar pencarian yang sama dua kali.
// =========================================================
import { STORAGE_KEYS } from './config.js';
import { storage } from './storage.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 30;
const BACKEND_TTL_MS = 5 * 60 * 1000;
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
export const MAX_RESULTS = 5;

const resultsCache = new Map(); // kueri ternormalisasi → { at, results }
let backendStatus = 'unknown'; // 'unknown' | 'ready' | 'missing'
let backendCheckedAt = 0;

// Kunci Tavily milik siswa (BYOK). String kosong = pakai kunci server.
export function getSearchKey() {
  const value = storage.get(STORAGE_KEYS.searchKey, '');
  return typeof value === 'string' ? value.trim() : '';
}

export function setSearchKey(value) {
  const key = String(value ?? '').trim();
  if (key) storage.set(STORAGE_KEYS.searchKey, key);
  else storage.remove(STORAGE_KEYS.searchKey);
  // Kesiapan server berubah → cek ulang saat UI disegarkan.
  backendStatus = 'unknown';
  backendCheckedAt = 0;
}

function isFresh(entry) {
  return Boolean(entry) && Date.now() - entry.at < CACHE_TTL_MS;
}

function remember(key, results) {
  if (resultsCache.size >= CACHE_MAX) {
    const oldest = resultsCache.keys().next().value;
    resultsCache.delete(oldest);
  }
  resultsCache.set(key, { at: Date.now(), results });
}

// URL http(s) saja, dedup per URL, isi dipangkas agar konteks tetap ringkas.
// Bentuk keluaran = { url, title, snippet, publishedDate }, sama dengan sumber
// grounding yang sudah dipakai UI.
export function normalizeSearchResults(input, limit = MAX_RESULTS) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const r of input) {
    if (!r || out.length >= limit) break;
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      url,
      title: String(r.title || url).replace(/\s+/g, ' ').trim().slice(0, 160),
      snippet: String(r.content || r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      publishedDate: String(r.publishedDate || r.published_date || '').slice(0, 10),
    });
  }
  return out;
}

// Deklarasi alat untuk endpoint OpenAI-compatible. Skema parameters WAJIB ada:
// tanpa itu model/endpoint menolak atau memanggil alat dengan argumen kosong.
export function buildSearchTool() {
  return {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Cari sumber web terkini. Panggil hanya bila materi siswa tidak cukup untuk menjawab. Mengembalikan judul, URL, cuplikan, dan tanggal terbit.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Kata kunci pencarian. Pakai bahasa Indonesia bila memungkinkan.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  };
}

// Deklarasi alat bentuk Claude native (input_schema, tanpa type:'function').
export function buildAnthropicSearchTool() {
  return {
    name: 'web_search',
    description:
      'Cari sumber web terkini. Panggil hanya bila materi siswa tidak cukup untuk menjawab. Mengembalikan judul, URL, cuplikan, dan tanggal terbit.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci pencarian. Pakai bahasa Indonesia bila memungkinkan.' },
      },
      required: ['query'],
    },
  };
}

export function isSearchBackendReady() {
  return backendStatus === 'ready';
}

export function clearSearchCache() {
  resultsCache.clear();
}

// Cek kesiapan: kunci BYOK → langsung siap (panggilan Tavily dari browser).
// Tanpa kunci → tanya /api/search; hosting statis tanpa Functions = missing.
export async function checkSearchBackend({ force = false, fetchImpl = fetch } = {}) {
  if (!force && backendStatus !== 'unknown' && Date.now() - backendCheckedAt < BACKEND_TTL_MS) {
    return backendStatus === 'ready';
  }
  if (getSearchKey()) {
    backendStatus = 'ready';
    backendCheckedAt = Date.now();
    return true;
  }
  try {
    const res = await fetchImpl('/api/search', {
      headers: { accept: 'application/json' },
    });
    const data = res.ok ? await res.json().catch(() => null) : null;
    backendStatus = data && data.ok && data.configured ? 'ready' : 'missing';
  } catch {
    backendStatus = 'missing';
  }
  backendCheckedAt = Date.now();
  return backendStatus === 'ready';
}

function mapSearchError(status, data) {
  const code = data && data.error;
  if (code === 'search-not-configured') {
    return { type: 'search', message: 'Pencarian web belum diaktifkan. Isi kunci Tavily di Pengaturan.' };
  }
  if (code === 'search-auth' || status === 401 || status === 403) {
    return { type: 'search', message: 'Kunci Tavily ditolak. Periksa kuncinya.' };
  }
  if (code === 'search-quota' || status === 429) {
    return { type: 'search', message: 'Kuota pencarian web habis. Coba lagi nanti.' };
  }
  if (code === 'empty-query') {
    return { type: 'search', message: 'Kata kunci pencarian kosong.' };
  }
  return { type: 'search', message: 'Layanan pencarian web sedang tidak bisa dihubungi.' };
}

// Panggilan langsung dari browser memakai kunci Tavily milik siswa. Dipakai
// bila server tidak punya Functions /api/search (mis. preview statis) —
// Tavily mengizinkan CORS, jadi pencarian tetap jalan tanpa backend.
async function searchViaTavily(q, { limit, signal, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: getSearchKey(),
        query: q,
        topic: 'general',
        search_depth: 'basic',
        max_results: limit,
        include_answer: false,
        include_raw_content: false,
      }),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw { type: 'search', message: 'Tidak bisa menghubungi Tavily. Periksa koneksi internet.' };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw mapSearchError(res.status, data);
  return normalizeSearchResults(data.results, limit);
}

// Hasil: { results, cached }. Melempar { type:'search', message } yang ramah.
export async function searchWeb(query, { limit = MAX_RESULTS, signal, fetchImpl = fetch } = {}) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!q) throw { type: 'search', message: 'Kata kunci pencarian kosong.' };

  const key = q.toLowerCase();
  const hit = resultsCache.get(key);
  if (isFresh(hit)) return { results: hit.results, cached: true };

  // Kunci sendiri → langsung ke Tavily (tidak bergantung pada Functions).
  if (getSearchKey()) {
    const results = await searchViaTavily(q, { limit, signal, fetchImpl });
    remember(key, results);
    return { results, cached: false };
  }

  let res;
  try {
    res = await fetchImpl('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q }),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw { type: 'search', message: 'Tidak bisa menghubungi layanan pencarian web.' };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) throw mapSearchError(res.status, data);

  const results = normalizeSearchResults(data.results, limit);
  remember(key, results);
  return { results, cached: false };
}
