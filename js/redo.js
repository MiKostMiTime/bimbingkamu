// =========================================================
// TanyaBukan — REDO / EDIT (FUNGSI MURNI)
// Merencanakan regenerasi balasan (redo) & sunting pesan (edit).
// Tidak menyentuh DOM; hanya memotong array pesan → {role, text}.
// Dipakai app.js untuk tombol "Regenerasi" & "Sunting".
// =========================================================

// Mirip buildContents() di app.js: saro role user|model, ubah ke {role, text}.
// Guard m && agar entry non-objek (mis. null) tidak merusak pemetaan.
function toContents(list) {
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'model'))
    .map((m) => ({ role: m.role, text: m.text }));
}

// REDO: regenerasi balasan model terakhir.
// modelIndex = indeks balasan model terakhir; contents = semua pesan sebelumnya.
export function planRedo(messages) {
  let modelIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] && messages[i].role === 'model') { modelIndex = i; break; }
  }
  if (modelIndex < 0) return null;
  return { modelIndex, contents: toContents(messages.slice(0, modelIndex)) };
}

// EDIT: sunting pesan user pada editIdx → regenerasi ke belakang.
// contents = sampai & termasuk user terakhir di seluruh array (bukan hanya editIdx),
// sehingga mengedit Q1 vs Q2 tetap menyimpan konteks yang sama; yang berubah hanya
// firstModelIndex (dimulai regenerasi dari balasan model pertama setelah titik sunting).
export function planEdit(messages, editIdx) {
  // Cari user terakhir di seluruh array untuk batas contents.
  let lastUserIndex = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i] && messages[i].role === 'user') { lastUserIndex = i; }
  }
  // Fallback bila tak ada user: pakai editIdx.
  const batas = lastUserIndex >= 0 ? lastUserIndex + 1 : editIdx + 1;

  // Balasan model pertama setelah titik sunting ( untuk mulai regenerasi berurutan).
  let firstModelIndex = -1;
  for (let i = editIdx + 1; i < messages.length; i += 1) {
    if (messages[i] && messages[i].role === 'model') { firstModelIndex = i; break; }
  }

  return { contents: toContents(messages.slice(0, batas)), firstModelIndex };
}

// Gabungkan hasil planRedo menjadi instruksi regenerasi untuk caller (app.js).
// Kembalikan { contents, modelIndex }, atau null bila plan tak ada / modelIndex
// tak terdefinisi / negatif / di luar rentang pesan. Guard modelIndex == null
// ditambahkan agar rencana kosong (mis. {}) juga aman → null, sesuai uji.
export function applyRedo(messages, plan) {
  if (!plan || !Array.isArray(messages)) return null;
  const { modelIndex } = plan;
  if (modelIndex == null || modelIndex < 0 || modelIndex >= messages.length) return null;
  return { contents: plan.contents, modelIndex };
}
