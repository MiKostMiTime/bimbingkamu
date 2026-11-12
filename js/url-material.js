// =========================================================
// BimbingKamu — MATERI DARI URL
// Mengambil satu halaman website lewat Pages Function /api/fetch lalu
// menjadikannya teks materi sesi (bentuk sama dengan hasil .pdf/.docx).
// =========================================================

const TIMEOUT_MS = 20000;

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

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });

  let res;
  try {
    res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, {
      headers: { accept: 'application/json' },
      signal: ac.signal,
    });
  } catch {
    throw { type: 'network', message: 'Tidak bisa menghubungi pembaca halaman. Server mungkin belum aktif.' };
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
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
