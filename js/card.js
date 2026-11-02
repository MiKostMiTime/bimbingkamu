// =========================================================
// TanyaBukan — CARD (Ekspor Kartu Studi ke PNG)
// Mengubah ringkasan sesi menjadi gambar PNG yang shareable
// (untuk WA/IG/Story). html2canvas dimuat on-demand (UMD dari
// CDN) hanya saat user mengetok "Ekspor kartu", jadi aturan
// "maks. 2 CDN di index.html" tetap utuh — pola sama seperti
// pdf.js (js/pdf.js) dan KaTeX (js/math.js).
// =========================================================

// ===== LIBRARY (dipin) =====
const HTML2CANVAS_LIB_URL =
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';

// ===== MUAT LIBRARY (sekali pakai, bisa retry) =====
// UMD menempel di globalThis.html2canvas. Gagal (offline/CDN mati)
// → error ramah; promise di-reset supaya percobaan berikutnya
// bisa mencoba ulang.
let h2cPromise = null;

function loadHtml2canvasOnce() {
  return new Promise((resolve, reject) => {
    const g = globalThis;
    if (g.html2canvas) {
      resolve(g.html2canvas);
      return;
    }
    const s = document.createElement('script');
    s.src = HTML2CANVAS_LIB_URL;
    s.async = true;
    s.onload = () =>
      g.html2canvas ? resolve(g.html2canvas) : reject(new Error('library html2canvas terbentuk tapi kosong'));
    s.onerror = () => reject(new Error('script library html2canvas gagal dimuat'));
    document.head.appendChild(s);
  });
}

export function loadHtml2canvas() {
  if (!h2cPromise) {
    h2cPromise = loadHtml2canvasOnce().catch((err) => {
      h2cPromise = null;
      throw {
        type: 'cdn',
        message:
          'Ekspor gambar butuh koneksi internet untuk memuat alat cetak. Muat ulang halaman, atau ekspor ke .md.',
        cause: err,
      };
    });
  }
  return h2cPromise;
}

// ===== UTIL: escape HTML (agar teks tutor aman melewati innerHTML) =====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== MARKDOWN SEDERHANA → HTML =====
// Memakai marked + DOMPurify (sudah global dari CDN di index.html).
// Jika CDN gagal (offline), turunkan ke teks polos yang di-escape.
function renderMarkdownToHtml(text) {
  const markedLib = window.marked;
  const purify = window.DOMPurify;
  if (!markedLib || !purify) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  const raw = markedLib.parse(text, { breaks: true, gfm: true });
  return purify.sanitize(raw);
}

// ===== BANGUN DOM KARTU STUDI =====
// `messages`: array pesan sesi (shape sama dengan state.messages).
// `meta`: { mode, level, model, date }. Mengembalikan node <div class="tb-card">
// yang siap dicetak ke PNG. Isi inti = balasan tutor (role 'model')
// yang di-render sebagai markdown agar rapi dan mudah dipindai.
export function buildStudyCard({ messages = [], meta = {} }) {
  const replies = messages
    .filter((m) => m.role === 'model' && typeof m.text === 'string' && m.text.trim())
    .map((m) => m.text.trim());

  // Gabungkan balasan, beri pemisah antar giliran. Batasi panjang agar
  // kartu tak terlalu tinggi (tetap shareable).
  const raw = replies.join('\n\n---\n').slice(0, 5200);
  const hasContent = replies.length > 0;

  const wrap = document.createElement('div');
  wrap.className = 'tb-card';
  // Lebar tetap + biarkan tinggi tumbuh mengikuti isi.
  wrap.style.width = '500px';
  wrap.style.position = 'relative';

  // --- Kepala: brand + badge mode ---
  const head = document.createElement('div');
  head.className = 'tb-card__head';

  const brand = document.createElement('div');
  brand.className = 'tb-card__brand';
  const logo = document.createElement('span');
  logo.className = 'tb-card__logo';
  logo.textContent = '💡';
  const brandText = document.createElement('div');
  const title = document.createElement('span');
  title.className = 'tb-card__title';
  title.textContent = 'TanyaBukan';
  const tagline = document.createElement('span');
  tagline.className = 'tb-card__tagline';
  tagline.textContent = 'Membimbing, bukan menjawab';
  brandText.append(title, tagline);
  brand.append(logo, brandText);

  const badge = document.createElement('span');
  badge.className = 'tb-card__badge';
  badge.textContent = meta.modeLabel || 'Belajar';

  head.append(brand, badge);
  wrap.appendChild(head);

  // --- Sub-judul bagian ---
  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'tb-card__section-title';
  sectionTitle.textContent = hasContent ? 'Poin-Poin Belajar' : 'Ringkasan Kosong';
  wrap.appendChild(sectionTitle);

  // --- Isi: markdown balasan tutor ---
  const body = document.createElement('div');
  body.className = 'tb-card__body';
  if (hasContent) {
    body.innerHTML = renderMarkdownToHtml(raw);
  } else {
    const empty = document.createElement('p');
    empty.className = 'tb-card__empty';
    empty.textContent = 'Belum ada balasan tutor di sesi ini.';
    body.appendChild(empty);
  }
  wrap.appendChild(body);

  // --- Meta bar (mode · kedalaman · model) ---
  const metaParts = [];
  if (meta.modeLabel) metaParts.push(meta.modeLabel);
  if (meta.level) metaParts.push(`Kedalaman ${meta.level}`);
  if (meta.model) metaParts.push(meta.model);
  if (meta.date || metaParts.length) {
    const bar = document.createElement('div');
    bar.className = 'tb-card__meta';
    bar.textContent = [meta.date, ...metaParts].filter(Boolean).join(' · ');
    wrap.appendChild(bar);
  }

  // --- Kaki: atribut sumber ---
  const foot = document.createElement('div');
  foot.className = 'tb-card__foot';
  foot.textContent = 'Ringkasan dari sesi TanyaBukan';
  wrap.appendChild(foot);

  return wrap;
}

// ===== GAYA ARTI KARTU (dimuat on-demand) =====
// Disuntikkan ke <head> sekali (mirip pola KaTeX). Hanya terpakai
// bila fitur ekspor kartu dipakai, jadi tak membebani halaman kosong.
let cardStylesInjected = false;
export function injectCardStyles() {
  if (cardStylesInjected || typeof document === 'undefined') return;
  cardStylesInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-tb-card', '');
  style.textContent = `
.tb-card {
  box-sizing: border-box;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  width: 500px;
  background: #ffffff;
  color: #18181B;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(20, 20, 40, 0.16);
  font-size: 15px;
  line-height: 1.55;
  text-align: left;
}
.tb-card *, .tb-card *::before, .tb-card *::after { box-sizing: border-box; }
.tb-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 22px 24px 18px;
  background: linear-gradient(135deg, #4F46E5 0%, #6D5AE7 100%);
  color: #ffffff;
}
.tb-card__brand { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.tb-card__logo {
  font-size: 30px;
  line-height: 1;
  width: 46px; height: 46px;
  display: grid; place-items: center;
  background: rgba(255,255,255,0.18);
  border-radius: 14px;
}
.tb-card__title { font-size: 21px; font-weight: 700; letter-spacing: -0.02em; }
.tb-card__tagline { font-size: 12.5px; opacity: 0.9; margin-top: 2px; display: block; }
.tb-card__badge {
  flex: 0 0 auto;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255,255,255,0.22);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.tb-card__section-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4F46E5;
  padding: 20px 24px 8px;
}
.tb-card__body {
  padding: 4px 24px 18px;
  font-size: 14.5px;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.tb-card__body > :first-child { margin-top: 0; }
.tb-card__body > :last-child { margin-bottom: 0; }
.tb-card__body p { margin: 0 0 10px; }
.tb-card__body ul, .tb-card__body ol { margin: 0 0 10px; padding-left: 20px; }
.tb-card__body li { margin: 3px 0; }
.tb-card__body h1, .tb-card__body h2, .tb-card__body h3 {
  font-size: 16px; font-weight: 700; margin: 14px 0 8px; line-height: 1.3;
}
.tb-card__body h4 { font-size: 15px; font-weight: 700; margin: 12px 0 6px; }
.tb-card__body strong { color: #111; }
.tb-card__body em { font-style: italic; }
.tb-card__body code {
  font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
  background: #EEF2FF; color: #4338CA; padding: 1px 5px; border-radius: 5px; font-size: 12.5px;
}
.tb-card__body hr {
  border: none; border-top: 1px dashed var(--color-border, #E4E4E7);
  margin: 14px 0;
}
.tb-card__body a { color: #4F46E5; }
.tb-card__empty { color: #71717A; font-style: italic; }
.tb-card__meta {
  margin: 0 24px;
  padding: 10px 14px;
  background: #EEF2FF;
  border-radius: 10px;
  font-size: 12px;
  color: #4338CA;
  font-weight: 500;
}
.tb-card__foot {
  margin-top: 16px;
  padding: 14px 24px 22px;
  border-top: 1px solid #F4F4F5;
  font-size: 11.5px;
  color: #71717A;
  text-align: center;
}
`;
  document.head.appendChild(style);
}
