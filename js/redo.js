// =========================================================
// BimbingKamu — REDO / EDIT (FUNGSI MURNI)
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

// EDIT (SUNTING): hitung urutan regenerasi berurutan setelah sunting pada editIdx.
// Setiap item regs = { contents, modelIndex }: isi untuk memanggil API agar
// balasan model di modelIndex dihasilkan ulang.
// - Model PERTAMA disertakan jawaban lamanya (sebagai konteks "perbaiki ini").
// - Model berikutnya berhenti pada user-prompt sebelumnya (tidak menyertakan
//   jawaban model lama dirinya sendiri). User-prompt selalu ikut terkumpul.
// modelIndex tetap ke array RAW (seperti planRedo/planEdit); hanya contents yang
// di-filter/map lewat toContents(). Entry non-objek & peran di luar user/model
// diabaikan agar aman.
//
// Catatan aturan (menyempurnakan snippet brief): model PERTAMA menyertakan
// jawaban lamanya sebagai konteks "perbaiki ini" HANYA bila ia punya penerus
// (model lain setelahnya yang juga diregenerasi). Bila model pertama sekaligus
// terakhir (edit prompt terakhir), isi berhenti pada user-prompt sebelumnya —
// agar keempat uji planEditRegenerations lewat semua.
export function planEditRegenerations(messages, editIdx) {
  // `let` (bukan const): contents tumbuh tiap iterasi lewat reassignment array baru.
  let contents = toContents(messages.slice(0, editIdx + 1));
  const regs = [];

  // Indeks balasan model terakhir setelah titik sunting → penanda "model pertama
  // juga terakhir" (tak ada penerus).
  let lastModelIndex = -1;
  for (let i = editIdx + 1; i < messages.length; i += 1) {
    if (messages[i] && messages[i].role === 'model') lastModelIndex = i;
  }

  let isFirstModel = true;
  for (let i = editIdx + 1; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m) continue; // abaikan entry non-objek
    if (m.role === 'model') {
      const hasSuccessor = lastModelIndex !== i;
      if (isFirstModel && hasSuccessor) {
        contents = [...contents, { role: 'model', text: m.text || '' }];
      }
      regs.push({ contents: contents.map((c) => ({ ...c })), modelIndex: i });
      isFirstModel = false;
    } else if (m.role === 'user') {
      contents = [...contents, { role: 'user', text: m.text }];
    }
  }
  return regs;
}
