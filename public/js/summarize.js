// js/summarize.js
// Auto-ringkas riwayat percakapan saat pemakaian konteks mendekati batas.
// Dipanggil app.js sebelum kirim balasan: pesan LAMA diringkas model menjadi
// satu pesan ringkasan (hidden), pesan TERAKHIR tetap utuh.

// Ambang pemicu: prompt terakhir >= 80% context window model.
export const SUMMARY_THRESHOLD = 0.8;

export function needsSummarize(lastPrompt, contextLimit) {
  if (!contextLimit || !lastPrompt) return false;
  return lastPrompt >= contextLimit * SUMMARY_THRESHOLD;
}

// Pisahkan riwayat: pesan lama -> diringkas; giliran terakhir (2 pesan
// user+model terakhir) -> tetap utuh. Pesan hidden (sapaan/ringkasan lama)
// ikut bagian lama. Return null bila tak ada yang layak diringkas.
export function splitForSummary(messages, keepCount = 2) {
  const idx = Math.max(0, messages.length - keepCount);
  const older = messages.slice(0, idx);
  const recent = messages.slice(idx);
  // Harus ada minimal satu balasan model di bagian lama — kalau cuma
  // sapaan/ketikan user, tidak ada gunanya meringkas.
  if (!older.some((m) => m.role === 'model')) return null;
  return { older, recent };
}

// System prompt untuk permintaan ringkasan — hasil dipakai ulang sebagai
// konteks, jadi harus padat, netral, dan mempertahankan istilah materi.
export function summarySystemPrompt() {
  return (
    'Kamu asisten yang meringkas riwayat percakapan belajar. ' +
    'Buat ringkasan padat dalam Bahasa Indonesia berisi: poin-poin penting ' +
    'yang sudah dibahas, istilah/konsep kunci (pertahankan istilah aslinya), ' +
    'dan pertanyaan siswa yang belum terjawab. Maksimal 150 kata, tanpa basa-basi.'
  );
}

// Bungkas hasil ringkasan menjadi pesan konteks (role user, hidden) yang
// dikirim ulang ke model pada giliran berikutnya.
export function summaryMessage(summary) {
  return {
    role: 'user',
    hidden: true,
    summary: true,
    text: `[RINGKASAN percakapan sebelumnya - diringkas otomatis agar muat konteks]\n${summary}`,
  };
}

// Bangun isi (array role/text) untuk dikirim ke endpoint dari sekumpulan pesan.
export function buildContentsFrom(messages) {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'model')
    .map((m) => ({ role: m.role, text: m.text }));
}
