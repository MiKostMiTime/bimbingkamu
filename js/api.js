// =========================================================
// TanyaBukan — API GEMINI
// Panggilan generateContent (REST) langsung dari browser.
// =========================================================
import { API } from './config.js';

// ===== PETA ERROR =====
// Ubah status HTTP / isi body error menjadi pesan ramah.
// Status 0 dipakai untuk error jaringan (fetch gagal).
const MESSAGES = {
  auth: 'Kunci API tidak valid. Periksa kembali kunci kamu.',
  quota: 'Kuota gratis hari ini habis. Coba lagi besok atau cek dashboard API-mu.',
  network: 'Tidak bisa terhubung ke layanan. Periksa koneksi internetmu.',
  model: 'Model ini tidak tersedia untuk kunci kamu. Coba pilih model lain.',
  server: 'Layanan Gemini sedang sibuk. Coba lagi beberapa saat.',
  unknown: 'Terjadi kesalahan tak terduga. Coba lagi beberapa saat.',
  badrequest: 'Permintaan ditolak. Materi mungkin terlalu panjang, atau coba matikan "Cari web".',
  truncated: 'Jawaban terpotong karena terlalu panjang. Minta tutor melanjutkan.',
};

// Pola untuk memperhalus klasifikasi dari teks error API (lebih akurat
// dari status saja, karena mis. kuota habis bisa datang sebagai 400).
const QUOTA_RE = /quota|RESOURCE_EXHAUSTED|rate limit|too many requests/i;
const NOTFOUND_RE = /not found|NOT_FOUND|deprecated|retired/i;
const AUTH_RE = /api key|PERMISSION_DENIED/i;

export function mapApiError(status, apiMessage = '') {
  const detail = { status, apiMessage };

  // 1) Klasifikasi dari isi pesan API (paling akurat).
  if (QUOTA_RE.test(apiMessage)) return { type: 'quota', message: MESSAGES.quota, ...detail };
  if (NOTFOUND_RE.test(apiMessage)) return { type: 'model', message: MESSAGES.model, ...detail };
  if (AUTH_RE.test(apiMessage)) return { type: 'auth', message: MESSAGES.auth, ...detail };

  // 2) Klasifikasi berdasarkan status HTTP.
  // Kunci salah yang datang sebagai 400 sudah tertangkap AUTH_RE di atas
  // ("API key not valid"). 400 lain = permintaan ditolak, bukan masalah kunci.
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

// ===== DAFTAR MODEL KUNCI =====
// GET /v1beta/models?key=... → model yang bisa dipakai kunci ini.
// Model hanya teks-Flash (kecuali model lama yang sudah mati → 404).
// Gagal (kunci salah, offline) → melempar error ramah pemakai mapApiError.
const CHAT_MODEL_RE = /^gemini-[\d.]+-flash(-lite)?$/;

export async function fetchAvailableModels(apiKey) {
  let res;
  try {
    // pageSize=1000: default ~50 bisa memotong daftar. Kunci lewat header, bukan URL.
    res = await fetch(`${API.baseUrl}?pageSize=1000`, {
      headers: { 'x-goog-api-key': apiKey },
    });
  } catch {
    throw { ...mapApiError(0) };
  }
  if (!res.ok) {
    let apiMessage = '';
    try {
      const err = await res.json();
      apiMessage = (err && err.error && (err.error.message || err.error.status)) || '';
    } catch {
      // Body bukan JSON — klasifikasi dari status saja.
    }
    throw { ...mapApiError(res.status, apiMessage) };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw { ...mapApiError(0) };
  }
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => (m.name || '').replace(/^models\//, ''))
    .filter((id) => CHAT_MODEL_RE.test(id));
}

// ===== PANGGIL GEMINI =====
// Parameter: { apiKey, model, systemPrompt, contents, thinkingLevel, webSearch }
// `contents` = array { role: 'user'|'model', text } (riwayat penuh).
// `webSearch`: aktifkan Google Search grounding (sumber kredibel dari
// ranking Google) — tanpa API key tambahan.
// Mengembalikan { text, sources }, atau melempar objek { type, message }.
export async function callGemini({
  apiKey,
  model,
  systemPrompt,
  contents,
  thinkingLevel = 'low',
  webSearch = false,
}) {
  const url = `${API.baseUrl}/${model}:generateContent`; // kunci di header, bukan URL

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: contents.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    // temperature/top_p/top_k sudah deprecated di Gemini 3.6+ → tidak dikirim.
    generationConfig: { maxOutputTokens: 8192 },
  };
  // thinking_level hanya untuk keluarga 3.6+ (Flash-Lite belum diverifikasi).
  if (/^gemini-3\.(6|7|8)-flash$/.test(model)) {
    body.generationConfig.thinkingConfig = { thinkingLevel };
  }
  if (webSearch) {
    // Google Search grounding: model menelusuri web; sumbernya kembali
    // di candidate.groundingMetadata (lihat extractSources).
    body.tools = [{ google_search: {} }];
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch melempar error saat offline / jaringan terputus.
    throw { ...mapApiError(0) };
  }

  if (!res.ok) {
    // Baca isi error API (alasan sebenarnya) untuk klasifikasi + diagnostik.
    let apiMessage = '';
    try {
      const err = await res.json();
      apiMessage = (err && err.error && (err.error.message || err.error.status)) || '';
    } catch {
      // Body bukan JSON (mis. halaman proxy) — klasifikasi dari status saja.
    }
    throw { ...mapApiError(res.status, apiMessage) };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw { ...mapApiError(0) };
  }

  const candidate = data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  const text = parts ? parts.map((p) => p.text || '').join('') : '';

  if (candidate && candidate.finishReason === 'MAX_TOKENS' && !text.trim()) {
    throw { type: 'truncated', message: MESSAGES.truncated };
  }

  if (!candidate || !text.trim()) {
    // Respons valid tapi kosong (mis. disaring safety).
    throw {
      type: 'empty',
      message:
        'AI tidak memberikan jawaban. Coba ulangi atau sederhanakan pertanyaanmu.',
    };
  }

  return { text: text.trim(), sources: extractSources(candidate) };
}

// ===== SUMBER WEB (GROUNDING) =====
// Ambil rujukan web dari groundingMetadata: hanya chunk ber-URI web,
// dedup per URL, maks 6 item, snippet (dari groundingSupports) dipangkas 500 karakter.
// Hasil [{ url, title, snippet }] — data polos, aman disimpan ke
// materi sesi (localStorage) dan ke ekspor.
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
