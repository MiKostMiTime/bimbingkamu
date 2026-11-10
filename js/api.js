// =========================================================
// BimbingKamu — UTIL API
// Peta error + ekstraksi sumber web. Panggilan chat kini lewat
// js/providers.js (path [OI]-generic per endpoint).
// =========================================================

// ===== PETA ERROR =====
// Ubah status HTTP / isi body error menjadi pesan ramah.
// Status 0 dipakai untuk error jaringan (fetch gagal).
const MESSAGES = {
  auth: 'Kunci API tidak valid untuk endpoint ini. Periksa kembali kunci atau kosongkan bila endpoint lokal.',
  payment: 'Kredit atau metode pembayaran endpoint belum diatur (mis. OpenRouter butuh kredit). Tambahkan kredit / billing di settings provider, lalu pilih model dan coba lagi.',
  lmstudioToken: 'LM Studio ini mewajibkan token. Buka LM Studio → Developer → Server Settings → Manage Tokens, buat token baru, lalu tempel di kolom Kunci API endpoint ini.',
  quota: 'Kuota/rate limit endpoint tercapai. Coba lagi beberapa saat.',
  network: 'Tidak bisa terhubung ke endpoint. Periksa koneksi & URL. Untuk endpoint lokal (LM Studio/Ollama), aktifkan CORS di server. Untuk tunnel (ngrok/localtunnel), pastikan tunnel masih aktif.',
  model: 'Model ini tidak tersedia di endpoint. Coba pilih model lain dari daftar.',
  server: 'Endpoint sedang sibuk. Coba lagi beberapa saat.',
  unknown: 'Terjadi kesalahan tak terduga. Coba lagi beberapa saat.',
  badrequest: 'Permintaan ditolak endpoint. Kemungkinan model ini tidak kompatibel dengan format percakapan, coba gunakan model lain atau kurangi materi.',
  toobig: 'Materi atau riwayat percakapan terlalu besar untuk dikirim ke endpoint. Kurangi ukuran materi (hasil upload) atau ringkas percakapan, lalu coba lagi.',
  truncated: 'Jawaban terpotong karena terlalu panjang. Minta tutor melanjutkan.',
  blocked: 'Endpoint memblokir akses dari server Vercel (Cloudflare 403 "Attention Required! / You have been blocked"). Ini BUKAN masalah kunci API — endpoint belakang proteksi bot Cloudflare yang memblokir IP datacenter Vercel/AWS. Hubungi pemilik endpoint untuk memasukkan IP Vercel (54.175.0.0/16) ke allowlist Cloudflare, atau matikan "Attention Required!" bot challenge di path API.',
};

// Pola untuk memperhalus klasifikasi dari teks error API (lebih akurat
// dari status saja, karena mis. kuota habis bisa datang sebagai 400).
const QUOTA_RE = /quota|RESOURCE_EXHAUSTED|rate limit|too many requests/i;
const NOTFOUND_RE = /not found|NOT_FOUND|deprecated|retired/i;
const AUTH_RE = /api key|PERMISSION_DENIED|invalid_api_key|unauthorized/i;
// 402 Payment Required (mis. OpenRouter tanpa kredit) sering datang dengan
// pesan khas; kenali dari teksnya supaya tampil jelas, bukan "unknown".
const PAYMENT_RE = /insufficient credits?|payment required|add more credits|requires more credits|out of credits|credit balance/i;
// LM Studio 0.4.0+ bisa mewajibkan token. Pesannya khas, dan lebih berguna
// daripada pesan auth generik karena menyebut di mana token dibuat.
const LMSTUDIO_TOKEN_RE = /lm ?studio api token|lm_api_token/i;
// Endpoint belakang Cloudflare bot-protection membalas halaman HTML "Attention
// Required! / You have been blocked" (sering 403) BUKAN JSON API. Kenali dari
// isinya agar pesan yang muncul actionable, bukan "kunci API invalid" generik.
const BLOCKED_RE = /attention required|you have been blocked|blocked_why|enable cookies|cf-cookie-error|antibot|just a moment|checking your browser|i-am-human|cf-challenge|your ip is blocked from/i;

export function mapApiError(status, apiMessage = '', rawText = '') {
  const detail = { status, apiMessage };

  // 0) Body mentah (rawText) = kebenaran apa yang dikembalikan server. Endpoint
  //     belakang Cloudflare bot-protection membalas halaman HTML "Attention
  //     Required! / You have been blocked" (sering 403) BUKAN JSON API. Deteksi
  //     dari body mentah agar pesan actionable, bukan "auth" generik yang
  //     menyesatkan. Menang di atas semua heuristik berbasis teks & status.
  const blockText = String(rawText || '');
  if (blockText && BLOCKED_RE.test(blockText)) {
    return { type: 'blocked', message: MESSAGES.blocked, ...detail };
  }

  // 1) Klasifikasi dari isi pesan API (paling akurat).
  if (LMSTUDIO_TOKEN_RE.test(apiMessage)) return { type: 'auth', message: MESSAGES.lmstudioToken, ...detail };
  if (PAYMENT_RE.test(apiMessage)) return { type: 'payment', message: MESSAGES.payment, ...detail };
  if (QUOTA_RE.test(apiMessage)) return { type: 'quota', message: MESSAGES.quota, ...detail };
  if (NOTFOUND_RE.test(apiMessage)) return { type: 'model', message: MESSAGES.model, ...detail };
  if (AUTH_RE.test(apiMessage)) return { type: 'auth', message: MESSAGES.auth, ...detail };

  // 2) Klasifikasi berdasarkan status HTTP.
  if (status === 401 || status === 403) {
    return { type: 'auth', message: MESSAGES.auth, ...detail };
  }
  // 402 = pembayaran/kredit belum siap (mis. OpenRouter kehabisan kredit).
  if (status === 402) return { type: 'payment', message: MESSAGES.payment, ...detail };
  if (status === 400) return { type: 'badrequest', message: MESSAGES.badrequest, ...detail };
  if (status === 429) return { type: 'quota', message: MESSAGES.quota, ...detail };
  if (status === 0) return { type: 'network', message: MESSAGES.network, ...detail };
  if (status === 404) return { type: 'model', message: MESSAGES.model, ...detail };
  // 413 = request entity too large: materi/riwayat terlalu besar untuk endpoint.
  if (status === 413) return { type: 'badrequest', message: MESSAGES.toobig, ...detail };
  if (status >= 500) return { type: 'server', message: MESSAGES.server, ...detail };

  return { type: 'unknown', message: MESSAGES.unknown, ...detail };
}

// ===== SUMBER WEB (GROUNDING) =====
// Ambil rujukan web dari response endpoint (bila tersedia). Mendukung BEBERAPA
// shape agar jalan di SEMUA provider, lalu menyatukannya ke [{ url, title, snippet }]:
//   - Gemini native     : candidate.groundingMetadata.groundingChunks/Supports
//   - OpenAI-Gemini     : body.citations[]            ({ uri, title })
//   - OpenAI-Gemini     : body.grounding_metadata      (bersarang)
//   - Generic           : choices[].message.tool_calls[]
// Kredibel: hanya URL http(s), dedup per URL, maks 6 item, snippet dipangkas 500
// karakter. Data polos, aman disimpan ke materi sesi (localStorage) dan ke ekspor.
export function extractSources(input) {
  if (!input) return [];
  // 1) Gemini native (candidate.groundingMetadata) — jalur utama, output stabil.
  if (input.groundingMetadata) return fromGroundingMetadata(input.groundingMetadata);
  // 2) OpenAI-compatible: citations di top-level body.
  if (Array.isArray(input.citations)) return fromCitations(input.citations);
  // 3) OpenAI-compatible Gemini: grounding_metadata bersarang.
  if (input.grounding_metadata && input.grounding_metadata.groundingChunks) {
    return fromGroundingMetadata(input.grounding_metadata);
  }
  // 4) Generic: tool_calls (best-effort).
  if (Array.isArray(input.tool_calls)) return fromToolCalls(input.tool_calls);
  return [];
}

// ===== VALIDASI SUMBER (PEMBANTU MURNI) =====
// Dipakai renderSources di chat.js untuk menentukan apakah URL bisa dijadikan
// tautan (<a>) atau hanya teks, agar tidak ada tautan rusak dari shape yang
// tak punya skema (mis. groundingMetadata tanpa http).

// URL kredibel: hanya string dengan skema http(s). Field lain (relative path,
// number, null) → false, jadi renderSources menampilkannya sebagai teks biasa.
export function isValidHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// Pangkas snippet agar ringkas di bawah tautan; tambahkan elipsis '…' bila lebih
// dari max karakter. Mengembalikan '' bila kosong/tidak ada.
export function truncateSnippet(text, max = 200) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

// Klasifikasi state sumber web PER-JAWaban (logika murni, UI hanya membaca hasil):
//   'ok'        → websearch ON + grounding didukung + ada sumber
//   'not-found' → websearch ON + grounding didukung + tidak ada sumber
//   'unsupported'→ websearch ON + grounding TIDAK didukung
export function classifyWebSearch({ webSearch, supportsGrounding, sources }) {
  if (!webSearch) return 'not-found';
  if (!supportsGrounding) return 'unsupported';
  return Array.isArray(sources) && sources.length ? 'ok' : 'not-found';
}

// Shape native Gemini: isi kutipan ada di groundingSupports (segment.text),
// dihubungkan ke chunk lewat groundingChunkIndices — groundingChunks sendiri
// tidak punya teks. Hanya chunk ber-URI web, dedup per URL, maks 6.
function fromGroundingMetadata(gm) {
  const chunks = gm && Array.isArray(gm.groundingChunks) ? gm.groundingChunks : [];
  const supports = gm && Array.isArray(gm.groundingSupports) ? gm.groundingSupports : [];

  const snippetByChunk = new Map();
  for (const s of supports) {
    const t = s && s.segment && s.segment.text;
    if (!t) continue;
    for (const i of s.groundingChunkIndices || []) {
      snippetByChunk.set(i, `${snippetByChunk.get(i) || ''} ${t}`.trim());
    }
  }

  const seen = new Set();
  const out = [];
  chunks.forEach((c, idx) => {
    const url = c && c.web && c.web.uri;
    if (!url || seen.has(url) || out.length >= 6) return; // non-web / duplikat / batas
    seen.add(url);
    out.push({
      url,
      title: (c.web && c.web.title) || url,
      snippet: (snippetByChunk.get(idx) || '').slice(0, 500),
    });
  });
  return out;
}

// Shape OpenAI-Gemini: citations [{ uri, title, score? }] di top-level body.
function fromCitations(cits) {
  const seen = new Set();
  const out = [];
  for (const c of cits) {
    if (!c || out.length >= 6) continue;
    const url = c.uri || c.url || (c.web && c.web.uri);
    if (!url || typeof url !== 'string' || !/^https?:/.test(url)) continue; // kredibel: http(s)
    const key = normalizeUrl(url);
    if (seen.has(key)) continue; // dedup per URL
    seen.add(key);
    out.push({ url, title: c.title || url, snippet: '' });
  }
  return out;
}

// Shape generic: tool_calls[] (best-effort). Beberapa endpoint menyimpan rujukan
// di args JSON atau field custom (metadata.url / source).
function fromToolCalls(tcs) {
  const seen = new Set();
  const out = [];
  for (const tc of tcs) {
    if (!tc || out.length >= 6) continue;
    const args = tc.args && typeof tc.args === 'string' ? safeParse(tc.args) : tc.args;
    const meta = tc.metadata || {};
    const url = (args && (args.url || args.uri || args.source)) || meta.url || meta.uri;
    const title = (args && (args.title || args.name)) || meta.title;
    if (!url || typeof url !== 'string' || !/^https?:/.test(url)) continue; // kredibel: http(s)
    const key = normalizeUrl(url);
    if (seen.has(key)) continue; // dedup per URL
    seen.add(key);
    out.push({ url, title: title || url, snippet: '' });
  }
  return out;
}

// Normalisasi URL untuk dedup (hilangkan trailing slash).
function normalizeUrl(url) {
  try { return new URL(url).href.replace(/\/$/, ''); } catch { return url; }
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}
