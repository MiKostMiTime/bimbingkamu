// =========================================================
// BimbingKamu — MATERI DARI URL
// Mengambil satu halaman website lewat Pages Function /api/fetch lalu
// menjadikannya teks materi sesi (bentuk sama dengan hasil .pdf/.docx).
// =========================================================

const TIMEOUT_MS = 20000;
const READER_TIMEOUT_MS = 30000;
const MAX_CHARS = 200000;
// Pembaca publik untuk fallback saat server tidak punya /api/fetch (mis.
// preview statis) atau halaman menolak/dimuat dengan JavaScript.
const READER_PREFIX = 'https://r.jina.ai/';

async function request(url, { headers, signal, timeoutMs = TIMEOUT_MS } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { headers, signal: ac.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// r.jina.ai mengembalikan teks markdown + header metadata. Buang header itu
// agar materi bersih, lalu potong bila kepanjangan.
async function readViaReader(url, signal) {
  const res = await request(`${READER_PREFIX}${url}`, {
    headers: { accept: 'text/plain' },
    signal,
    timeoutMs: READER_TIMEOUT_MS,
  });
  if (!res.ok) throw new Error(`reader ${res.status}`);
  const raw = String((await res.text()) || '').trim();
  if (!raw) throw new Error('reader empty');
  const title = (raw.match(/^Title:\s*(.+)$/m) || [])[1] || '';
  const text = raw
    .replace(/^Title:\s*.*$/m, '')
    .replace(/^URL Source:\s*.*$/m, '')
    .replace(/^Published Time:\s*.*$/m, '')
    .replace(/^Markdown Content:\s*$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) throw new Error('reader empty');
  const truncated = text.length > MAX_CHARS;
  return {
    title: String(title || url).slice(0, 100),
    url,
    text: truncated ? text.slice(0, MAX_CHARS).trimEnd() : text,
    truncated,
  };
}

function mapFetchError(status, data) {
  const code = data && data.error;
  if (code === 'bad-url') return { type: 'badrequest', message: 'Alamat halaman tidak valid. Awali dengan https://' };
  if (code === 'forbidden') {
    return { type: 'badrequest', message: 'Alamat itu tidak bisa dibuka dari server (alamat lokal/privat). Pakai halaman publik.' };
  }
  if (code === 'not-html') {
    return { type: 'badrequest', message: 'Alamat itu bukan halaman web (mis. file gambar atau PDF). Untuk PDF, unggah filenya langsung.' };
  }
  if (code === 'too-large') {
    return { type: 'badrequest', message: 'Halaman itu terlalu besar untuk dibaca. Pakai halaman lain atau salin bagian pentingnya ke .txt.' };
  }
  if (code === 'empty') {
    return {
      type: 'badrequest',
      message: 'Halaman itu tidak berisi teks terbaca. Biasanya isinya dimuat dengan JavaScript. Salin teksnya ke .txt sebagai gantinya.',
    };
  }
  if (code === 'blocked') {
    return {
      type: 'network',
      message: 'Situs itu memblokir pembaca otomatis (butuh login atau proteksi bot). Buka halamannya lalu salin teksnya ke .txt, atau unggah versi PDF-nya.',
    };
  }
  if (code === 'fetch-status' || status === 502) {
    return { type: 'network', message: 'Halaman itu menolak dibuka (mungkin butuh login atau memblokir pembaca otomatis).' };
  }
  return { type: 'network', message: 'Halaman tidak bisa dibaca. Periksa alamatnya lalu coba lagi.' };
}

// Hasil: { title, url, text, truncated }.
export async function fetchUrlMaterial(rawUrl, { signal } = {}) {
  const url = String(rawUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    throw { type: 'badrequest', message: 'Alamat harus diawali http:// atau https://.' };
  }

  let res;
  try {
    res = await request(`/api/fetch?url=${encodeURIComponent(url)}`, {
      headers: { accept: 'application/json' },
      signal,
    });
  } catch {
    // Server/pembaca bawaan tidak bisa dihubungi → coba pembaca publik.
    try {
      return await readViaReader(url, signal);
    } catch {
      throw { type: 'network', message: 'Tidak bisa menghubungi pembaca halaman. Jalankan npm run dev atau periksa jaringan.' };
    }
  }

  const data = await res.json().catch(() => null);
  const code = data && data.error;
  const serverMissing = res.status === 404 || !data;
  const retryable = serverMissing
    || code === 'empty'
    || code === 'blocked'
    || code === 'fetch-status'
    || code === 'fetch-network'
    || res.status >= 500;
  if (retryable) {
    try {
      return await readViaReader(url, signal);
    } catch {
      // Jatuhkan ke pesan server di bawah.
    }
  }

  if (!res.ok || !data || data.ok === false) throw mapFetchError(res.status, data);

  const text = String(data.text || '').trim();
  if (!text) {
    throw { type: 'badrequest', message: 'Halaman itu tidak berisi teks terbaca.' };
  }
  return {
    title: String(data.title || url).slice(0, 100),
    url: String(data.url || url),
    text,
    truncated: Boolean(data.truncated),
  };
}
