// =========================================================
// TanyaBukan — DOCX
// Ekstraksi teks dari file Word (.docx) yang diunggah.
// Memakai mammoth 1.11.0 (UMD self-contained, version dipin)
// dari CDN — dimuat on-demand (tag <script>) hanya ketika
// user mengunggah .docx, jadi aturan "maks. 2 CDN di
// index.html" tetap utuh (satu pustaka = satu tag).
// =========================================================

// ===== LIBRARY (dipin) =====
const DOCX_LIB_URL =
  'https://cdn.jsdelivr.net/npm/mammoth@1.11.0/mammoth.browser.min.js';

// ===== MUAT LIBRARY (sekali pakai, bisa retry) =====
// UMD menempel di globalThis.mammoth. Gagal (offline/CDN mati)
// → error ramah; promise di-reset supaya percobaan berikutnya
// bisa mencoba ulang.
let docxLibPromise = null;

function loadDocxLibOnce() {
  return new Promise((resolve, reject) => {
    const g = globalThis;
    if (g.mammoth) {
      resolve(g.mammoth);
      return;
    }
    const s = document.createElement('script');
    s.src = DOCX_LIB_URL;
    s.async = true;
    s.onload = () =>
      g.mammoth
        ? resolve(g.mammoth)
        : reject(new Error('library DOCX terbentuk tapi kosong'));
    s.onerror = () => reject(new Error('script library DOCX gagal dimuat'));
    document.head.appendChild(s);
  });
}

export function loadDocxLib() {
  if (!docxLibPromise) {
    docxLibPromise = loadDocxLibOnce().catch((err) => {
      docxLibPromise = null;
      throw {
        type: 'cdn',
        message:
          'Library DOCX gagal dimuat (butuh koneksi ke internet). Muat ulang halaman, atau unggah .txt/.md/.pdf.',
        cause: err,
      };
    });
  }
  return docxLibPromise;
}

// ===== EKSTRAK TEKS DOCX =====
// `file`: objek File. `libLoader`: injeksi library (untuk test);
// default loadDocxLib(). Mengembalikan teks dokumen, atau
// MELEMPAR objek { type, message } — dijamin tidak ada error
// mentah yang keluar dari fungsi ini.
export async function extractDocxText(file, libLoader = loadDocxLib) {
  let mammoth;
  try {
    mammoth = await libLoader();
  } catch (err) {
    throw err; // sudah berupa error ramah dari loader (mis. 'cdn')
  }

  try {
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    const text = String(result.value || '')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!text) {
      // Dokumen terparse tapi nol karakter (mis. hanya gambar).
      throw {
        type: 'empty',
        message:
          'File .docx ini tidak berisi teks terbaca. Coba file lain (.txt/.md/.pdf).',
      };
    }
    return text;
  } catch (err) {
    // Pengaman terakhir: error mentah mana pun (file korup, zip
    // rusak, dsb.) harus tetap keluar sebagai pesan ramah.
    console.error('[TanyaBukan] DOCX gagal diproses:', err);
    if (err && err.type) throw err; // hasil klasifikasi di atas
    throw {
      type: 'invalid',
      message:
        'File .docx tidak bisa dibaca (mungkin rusak). Coba file lain.',
    };
  }
}
