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

// ===== VECTORSIMILARITY CLIENT-SIDE (TF-IDF + cosine) =====
// Ringan, tanpa dependency eksternal. Vektor tiap chunk = bobot TF-IDF token
// hasil tokenize(); kesamaan diukur dengan cosine similarity. Kosakata diambil
// dari query saja agar vektor kecil & cepat; frekuensi chunk dihitung sekali
// (eager) saat ranking.

// Pecah teks → array chunk. Default per-paragraf (seperti splitParagraphs).
// Bila maxWords > 0, paragraf yang melebihi batas dipecah ke window kata dengan
// overlap agar chunk tetap utuh dan tidak terlalu besar (manfaat split terjaga).
export function chunkText(text, { maxWords = 0, overlap = 0 } = {}) {
  const paragraphs = splitParagraphs(text);
  if (!maxWords || maxWords <= 0) return paragraphs;
  const chunks = [];
  for (const p of paragraphs) {
    const words = p.split(/\s+/);
    if (words.length <= maxWords) {
      chunks.push(p);
      continue;
    }
    const step = Math.max(1, maxWords - overlap);
    for (let start = 0; start < words.length; start += step) {
      chunks.push(words.slice(start, start + maxWords).join(' '));
    }
  }
  return chunks;
}

// Hitung Map token -> frekuensi untuk satu blok token.
export function toTermFreq(tokens) {
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return freq;
}

// Bobot IDF korpus: ln(1 + N / df), N = jumlah chunk, df = jumlah chunk pemuat token.
// log(1 + x) menjaga token yang muncul di semua chunk tetap punya bobot > 0.
export function computeIdf(chunkFreqs) {
  const n = chunkFreqs.length;
  const df = new Map();
  for (const freq of chunkFreqs) {
    for (const token of freq.keys()) df.set(token, (df.get(token) || 0) + 1);
  }
  const idf = new Map();
  for (const [token, count] of df) idf.set(token, Math.log(1 + n / count));
  return idf;
}

// Cosine similarity dua vektor (array sejajar, non-negatif). Hasil 0..1.
export function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!dot || !normA || !normB) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // Pembulatan float bisa melewati 1.0; klip ke [0,1] agar aman untuk tampilan %.
  return Math.min(1, Math.max(0, sim));
}

// Bangun vektor TF-IDF satu blok (Map token->freq) dalam basis vocab yang sama.
function tfidfVector(freq, vocab, idf) {
  return vocab.map((token) => (freq.get(token) || 0) * (idf.get(token) || 0));
}

// Ambil N chunk paling relevan terhadap query berdasarkan cosine similarity
// vektor TF-IDF. Kembalikan [{ chunk, score }] terurut turun (score 0..1),
// pertahankan urutan asli saat skor sama. Vocab = token query saja; frekuensi
// tiap chunk dihitung sekali (eager) agar pencarian cepat.
export function retrieveWithScores(text, query, topN = 6, chunkOpts = {}) {
  const chunks = chunkText(text, chunkOpts);
  if (!chunks.length || !query) return [];
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];
  const vocab = [...new Set(queryTokens)];
  const chunkFreqs = chunks.map((c) => toTermFreq(tokenize(c)));
  const idf = computeIdf(chunkFreqs);
  const queryVec = tfidfVector(toTermFreq(queryTokens), vocab, idf);
  return chunks
    .map((chunk, i) => ({ chunk, score: cosine(queryVec, tfidfVector(chunkFreqs[i], vocab, idf)), i }))
    .filter((x) => x.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .slice(0, topN);
}

// Gabung chunk hasil ranking menjadi string untuk pipeline prompt. annotate=true
// menyisipkan penanda kesamaan (mis. "[[87%]]") di depan tiap chunk agar UI/model
// bisa melihat tingkat kesamaan; default false (bersih untuk konteks model).
export function joinScoredChunks(scored, { annotate = false } = {}) {
  return scored
    .map((x) => (annotate ? `[[${Math.round(x.score * 100)}%]] ${x.chunk}` : x.chunk))
    .join('\n\n');
}
