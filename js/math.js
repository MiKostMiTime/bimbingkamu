// =========================================================
// TanyaBukan — MATH (KaTeX)
// Render rumus LaTeX ($...$ / $$...$$) dari balasan Gemini
// agar tampil sebagai rumus visual, bukan teks mentah.
// KaTeX (version dipin) dimuat on-demand hanya saat ada
// rumus — aturan "maks. 2 CDN di index.html" tetap utuh
// (pola sama seperti pdf.js).
// =========================================================

const KATEX_JS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.mjs';
const KATEX_CSS_URL = 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css';

// Muat modul KaTeX sekali pakai (dynamic import). CSS (dan
// font yang di-referensinya) disuntikkan ke <head>.
let katexPromise = null;
export function loadKatex() {
  if (!katexPromise) {
    katexPromise = (async () => {
      if (!document.querySelector('link[data-tb-katex]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = KATEX_CSS_URL;
        link.setAttribute('data-tb-katex', '');
        document.head.appendChild(link);
      }
      const mod = await import(KATEX_JS_URL);
      return mod.render ? mod : mod.default;
    })();
  }
  return katexPromise;
}

// ===== DETEKSI RUAS RUMUS (sebelum markdown) =====
//   $$..$$  dan  \[..\]  → display (rumus tersendiri)
//   \(..\)  dan  $..$    → inline
// Setiap ruas diganti token @@TB_MATH_n@@ yang aman melewati
// marked + DOMPurify; di-ganti kembali ke output KaTeX
// setelah render (lihat hydrateMath di chat.js).
const MATH_RE =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\$\n]+?)\$/g;

export function extractMath(text) {
  const math = [];
  const safe = String(text).replace(MATH_RE, (m, d1, d2, i1, i2) => {
    const tex = (d1 ?? d2 ?? i1 ?? i2).trim();
    const display = Boolean(d1 ?? d2);
    math.push({ tex, display });
    return `@@TB_MATH_${math.length - 1}@@`;
  });
  return { text: safe, math };
}
