// =========================================================
// TanyaBukan — PDF
// Ekstraksi teks dari file PDF yang diunggah.
// Memakai pdf.js 3.11.174 (UMD, version dipin), diservis dari
// repository ini (./vendor/pdfjs) — dimuat on-demand saat user
// benar-benar mengunggah file .pdf.
//
// Kenapa v3 (bukan v6 terbaru)? pdf.js 6 memakai
// Promise.withResolvers (butuh browser 2023+) di jalur
// komunikasi worker — browser lebih lama akan melempar
// TypeError mentah. v3 bebas dari jebakan itu dan tetap
// mumpuni untuk ekstraksi teks.
// =========================================================

// ===== LIBRARY (dipin) =====
const PDF_LIB_URL = './vendor/pdfjs/pdf.min.js';
const PDF_WORKER_URL = './vendor/pdfjs/pdf.worker.min.js';

// ===== MUAT LIBRARY (sekali pakai, bisa retry) =====
// UMD menempel di globalThis.pdfjsLib. Gagal memuat (berkas vendor
// hilang/diblokir) → error ramah; promise di-reset agar retry berikut
// bisa mencoba lagi.
let pdfLibPromise = null;

function loadPdfLibOnce() {
  return new Promise((resolve, reject) => {
    const g = globalThis;
    if (g.pdfjsLib) {
      resolve(g.pdfjsLib);
      return;
    }
    const s = document.createElement('script');
    s.src = PDF_LIB_URL;
    s.async = true;
    s.onload = () =>
      g.pdfjsLib
        ? resolve(g.pdfjsLib)
        : reject(new Error('library PDF terbentuk tapi kosong'));
    s.onerror = () => reject(new Error('script library PDF gagal dimuat'));
    document.head.appendChild(s);
  });
}

export function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = loadPdfLibOnce().catch((err) => {
      pdfLibPromise = null;
      throw {
        type: 'vendor',
        message:
          'Library PDF gagal dimuat (berkas lokal vendor/pdfjs tidak ditemukan). Muat ulang halaman, atau unggah .txt/.md/.docx.',
        cause: err,
      };
    });
  }
  return pdfLibPromise;
}

// ===== ITEM HALAMAN → TEKS RAPI =====
// Gabungkan item teks pdf.js (str + hasEOL) lalu rapikan spasi/baris.
export function itemsToText(items) {
  if (!Array.isArray(items)) return '';
  const raw = items
    .map((it) => `${(it.str || '').trim()}${it.hasEOL ? '\n' : ' '}`)
    .join('');
  return raw
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ===== KLASIFIKASI ERROR pdf.js → PESAN RAMAH =====
// Exception pdf.js (PasswordException, InvalidPDFException, dsb.)
// bukan Error standar dan tidak punya properti .type — hanya .name.
// Petakan ke pesan ramah agar tidak ada error mentah yang bocor ke UI.
function classifyPdfError(err) {
  const name = err && err.name;
  if (name === 'PasswordException') {
    return {
      type: 'password',
      message:
        'PDF ini terkunci kata sandi, jadi teksnya tidak bisa diekstrak. Buka dulu di aplikasi PDF, simpan ulang tanpa kunci, lalu unggah lagi — atau unggah .txt/.md/.docx.',
    };
  }
  return {
    type: 'invalid',
    message:
      'File PDF tidak bisa dibaca (mungkin rusak). Coba file lain, atau salin materinya ke .txt/.md.',
  };
}

// ===== EKSTRAK TEKS SELURUH PDF =====
// `file`: objek File. `libLoader`: injeksi library (untuk test);
// default loadPdfLib(). Mengembalikan teks semua halaman, atau
// MELEMPAR objek { type, message } — dijamin tidak ada error
// mentah yang keluar dari fungsi ini.
export async function extractPdfText(file, libLoader = loadPdfLib) {
  let pdfjs;
  try {
    pdfjs = await libLoader();
  } catch (err) {
    throw err; // sudah berupa error ramah dari loader
  }

  try {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

    let doc;
    try {
      const data = await file.arrayBuffer();
      doc = await pdfjs.getDocument({ data }).promise;
    } catch (err) {
      // PDF terkunci (PasswordException) / rusak (InvalidPDFException).
      throw classifyPdfError(err);
    }

    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      try {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const text = itemsToText(tc.items);
        if (text) pages.push(text);
        await page.cleanup();
      } catch {
        // Satu halaman gagal tidak menggugurkan halaman lain.
      }
    }
    try {
      await doc.destroy();
    } catch {
      // Pembersihan gagal tidak masalah — file-nya lokal.
    }

    if (!pages.length) {
      // PDF scan: ada halaman tapi nol karakter teks.
      throw {
        type: 'scanned',
        message:
          'PDF ini tampaknya hasil scan (tanpa lapisan teks). Coba unggah .txt/.md/.docx.',
      };
    }

    return pages.join('\n\n');
  } catch (err) {
    // Pengaman terakhir: error mentah mana pun dari dalam pipeline
    // (worker, parse, dsb.) harus tetap keluar sebagai pesan ramah.
    console.error('[TanyaBukan] PDF gagal diproses:', err);
    if (err && err.type) throw err; // hasil klasifikasi di atas
    throw {
      type: 'invalid',
      message:
        'File PDF tidak bisa dibaca (mungkin rusak). Coba file lain (.txt/.md/.docx).',
    };
  }
}
