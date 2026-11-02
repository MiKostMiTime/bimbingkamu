// =========================================================
// TanyaBukan — UTIL API
// Peta error + ekstraksi sumber web. Panggilan chat kini lewat
// js/providers.js (path [OI]-generic per endpoint).
// =========================================================

// ===== PETA ERROR =====
// Ubah status HTTP / isi body error menjadi pesan ramah.
// Status 0 dipakai untuk error jaringan (fetch gagal).
const MESSAGES = {
  auth: 'Kunci API tidak valid untuk endpoint ini. Periksa kembali kunci atau kosongkan bila endpoint lokal.',
  quota: 'Kuota/rate limit endpoint tercapai. Coba lagi beberapa saat.',
  network: 'Tidak bisa terhubung ke endpoint. Periksa koneksi & URL — bila endpoint lokal (LM Studio/Ollama), aktifkan "Enable CORS" di pengaturan server-nya.',
  model: 'Model ini tidak tersedia di endpoint. Coba pilih model lain dari daftar.',
  server: 'Endpoint sedang sibuk. Coba lagi beberapa saat.',
  unknown: 'Terjadi kesalahan tak terduga. Coba lagi beberapa saat.',
  badrequest: 'Permintaan ditolak endpoint. Materi mungkin terlalu panjang, atau model tidak mendukung fitur itu.',
  truncated: 'Jawaban terpotong karena terlalu panjang. Minta tutor melanjutkan.',
};

// Pola untuk memperhalus klasifikasi dari teks error API (lebih akurat
// dari status saja, karena mis. kuota habis bisa datang sebagai 400).
const QUOTA_RE = /quota|RESOURCE_EXHAUSTED|rate limit|too many requests/i;
const NOTFOUND_RE = /not found|NOT_FOUND|deprecated|retired/i;
const AUTH_RE = /api key|PERMISSION_DENIED|invalid_api_key|unauthorized/i;

export function mapApiError(status, apiMessage = '') {
  const detail = { status, apiMessage };

  // 1) Klasifikasi dari isi pesan API (paling akurat).
  if (QUOTA_RE.test(apiMessage)) return { type: 'quota', message: MESSAGES.quota, ...detail };
  if (NOTFOUND_RE.test(apiMessage)) return { type: 'model', message: MESSAGES.model, ...detail };
  if (AUTH_RE.test(apiMessage)) return { type: 'auth', message: MESSAGES.auth, ...detail };

  // 2) Klasifikasi berdasarkan status HTTP.
  if (status === 401 || status === 403) {
    return { type: 'auth', message: MESSAGES.auth, ...detail };
  }
  if (status === 400) return { type: 'badrequest', message: MESSAGES.badrequest, ...detail };
  if (status === 429) return { type: 'quota', message: MESSAGES.quota, ...detail };
  if (status === 0) return { type: 'network', message: MESSAGES.network, ...detail };
  if (status === 404) return { type: 'model', message: MESSAGES.model, ...detail };
  if (status >= 500) return { type: 'server', message: MESSAGES.server, ...detail };

  return { type: 'unknown', message: MESSAGES.unknown, ...detail };
}

// ===== SUMBER WEB (GROUNDING) =====
// Ambil rujukan web dari groundingMetadata (bila endpoint menyediakan):
// hanya chunk ber-URI web, dedup per URL, maks 6 item, snippet (dari
// groundingSupports) dipangkas 500 karakter. Hasil [{ url, title, snippet }]
// — data polos, aman disimpan ke materi sesi (localStorage) dan ke ekspor.
export function extractSources(candidate) {
  const gm = candidate && candidate.groundingMetadata;
  const chunks = gm && Array.isArray(gm.groundingChunks) ? gm.groundingChunks : [];
  const supports = gm && Array.isArray(gm.groundingSupports) ? gm.groundingSupports : [];

  // Isi kutipan ada di groundingSupports (segment.text), dihubungkan ke chunk
  // lewat groundingChunkIndices — groundingChunks sendiri tidak punya teks.
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
