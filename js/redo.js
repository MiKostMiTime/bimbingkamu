// js/redo.js
// Fungsi murni untuk merencanakan regenerasi balasan (redo) & sunting pesan (edit).
// Tidak menyentuh DOM; hanya memotong array pesan → {role, text}.

// Mirip buildContents() di app.js: saring role user|model, ubah ke {role, text}.
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
    if (messages[i].role === 'model') { modelIndex = i; break; }
  }
  if (modelIndex < 0) return null;
  return { modelIndex, contents: toContents(messages.slice(0, modelIndex)) };
}

// EDIT: sunting pesan user pada editIdx → regenerasi ke belakang.
// contents = sampai & termasuk user terakhir di seluruh array (bukan hanya editIdx),
// sehingga mengedit Q1 vs Q2 tetap menyimpan [Q1, A1, Q2] sebagai konteks.
// firstModelIndex = balasan model pertama setelah titik sunting (dimulai regenerasi).
export function planEdit(messages, editIdx) {
  // Cari user terakhir di seluruh array untuk batas contents.
  let lastUserIndex = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].role === 'user') { lastUserIndex = i; }
  }
  // Fallback bila tak ada user: pakai editIdx.
  const batas = lastUserIndex >= 0 ? lastUserIndex + 1 : editIdx + 1;

  // Balasan model pertama setelah titik sunting (untuk mulai regenerasi berurutan).
  let firstModelIndex = -1;
  for (let i = editIdx + 1; i < messages.length; i += 1) {
    if (messages[i].role === 'model') { firstModelIndex = i; break; }
  }

  return { contents: toContents(messages.slice(0, batas)), firstModelIndex };
}
