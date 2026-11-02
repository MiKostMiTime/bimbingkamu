// js/rag.js
// Retrieval-Augmented Generation ringan per-paragraf untuk materi tebal.
// Pecah materi menjadi paragraf, beri skor kesamaan dengan pertanyaan siswa
// berdasarkan tumpukan kata kunci (keyword overlap), lalu ambil N paragraf
// paling relevan agar yang dikirim ke model hanya potongan — bukan seluruh
// isi file (hemat konteks & biaya).

// Pecah teks menjadi array paragraf: dipisah oleh baris kosong (>= 2 newline).
// Paragraf kosong dihilangkan; tiap paragraf diringkas spasi berlipatnya.
export function splitParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Tokenize: lowercase, pisah non-alfabet (tetap mendukung huruf Indonesia &
// angka), buang token terlalu pendek. Tanpa stopword list agar kata kunci
// materi (mis. "klorofil") tetap terhitung.
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

// Skor kesamaan satu paragraf terhadap daftar token pertanyaan:
//   +1 tiap token pertanyaan yang muncul di paragraf,
//   +bonus kecil bila dua+ token pertanyaan berurutan (menandakan frasa).
export function scoreParagraph(paragraph, queryTokens) {
  if (!queryTokens.length) return 0;
  const words = tokenize(paragraph);
  const idx = new Map();
  words.forEach((w, i) => { if (!idx.has(w)) idx.set(w, []); idx.get(w).push(i); });
  let score = 0;
  for (const q of queryTokens) {
    const positions = idx.get(q);
    if (positions && positions.length) {
      score += positions.length; // makin sering disebut, makin relevan
      // bonus frasa: token pertanyaan berdekatan di paragraf
      let consecutive = 0;
      for (let i = 1; i < positions.length; i++) {
        if (positions[i] - positions[i - 1] <= 3) consecutive++;
      }
      score += consecutive * 0.5;
    }
  }
  return score;
}

// Ambil N paragraf paling relevan (berdasarkan skor), mempertahankan urutan
// aslinya di teks asli agar konteks tetap runtut. Return string hasil gabung,
// atau '' bila tak ada paragraf / query kosong.
export function selectRelevantParagraphs(text, query, topN = 6) {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length || !query) return '';
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return '';
  // Simpan index asli untuk mengurutkan ulang setelah sorting.
  const scored = paragraphs.map((p, i) => ({ p, i, s: scoreParagraph(p, queryTokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i)) // skor turun, lalu urutan asli
    .slice(0, topN)
    .map((x) => x.i);
  const chosen = new Set(scored);
  return paragraphs.filter((_, i) => chosen.has(i)).join('\n\n');
}
