# TanyaBukan Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan tiga fitur ke TanyaBukan — regenerasi/sunting balasan (*redo/edit*), dukungan provider OpenAI-compatible (daftar model otomatis sesuai endpoint+kunci), dan indikator biaya + token keluar per balasan.

**Architecture:** Satu abstraksi provider (`js/providers.js`) menggantikan panggilan Gemini-specific di `app.js`; logika redo/edit dipisah jadi fungsi murni (`js/redo.js`) agar mudah diuji; tabel harga terpisah di `js/pricing.js`. Semua fitur "menumpang" tangkap `usage` (token) dari response API. UI mengikuti design system yang sudah ada (`.panel`, `.field`, `.btn--ghost.btn--sm`, `.msg__footer`).

**Tech Stack:** HTML/CSS/JS statis, ES Modules, Gemini/OpenAI REST via `fetch`, `marked` + `DOMPurify`, KaTeX on-demand. Uji: `node --test` (`.mjs`), tanpa dependensi tambahan.

**Spec:** [`docs/superpowers/specs/2026-11-01-tanyabukan-enhancement-design.md`](../specs/2026-11-01-tanyabukan-enhancement-design.md) — baca bersamaan; plan arguing dari spec.

## Global Constraints

- **Tanpa backend.** Kunci API + token hanya di `localStorage` (`tanyabukan.*`); tidak pernah dikirim ke server pihak ketiga selain endpoint model.
- **Bahasa Indonesia** untuk semua teks UI (copy sudah ada, jaga konsistensi: "Tutor", "Kamu", "Regenerasi", "Sunting").
- **Gemini tetap default**; provider custom (Groq/DeepSeek/Ollama/LM Studio) lewat OpenAI-compatible. Daftar model **dari** endpoint `/models`, bukan hardcoded.
- **Token keluar (`completionTokens`) selalu tampil; biaya estimasi hanya bila harga model diketahui** (model di tabel → biaya; luar tabel → token saja).
- **Redo = regenerasi balasan model terakhir**; **Edit = sunting pesan user → regenerasi semua balasan model setelahnya**.
- **Grounding & thinkingLevel = ops per-provider + graceful degradation**: aktif bila endpoint mendukung, otomatis dilepas (retry tanpa field) bila ditolak — bukan error.
- **Reuse `streamText`** yang sudah ada untuk efek ketik progresif; tidak membangun streaming token-per-kata baru.
- **Tabel harga hardcoded & editable** di `js/pricing.js`; harga indikatif per 1M token (USD), biaya = `completionTokens × outputPerM / 1e6`.
- **Regression:** 20 test lama di `tests/core.test.mjs` tetap lolos; 0 error console/page setelah interaksi.

---

## Fasa & Peta Tugas

| Fasa | Tugas | Fitur |
|------|-------|-------|
| **P1** | 1–4 | Tools chat (redo + edit) — di atas path Gemini sekarang |
| **P2** | 5–7 | Provider unified (OpenAI-compatible) |
| **P3** | 8–9 | Indikator biaya/token |
| — | 10 | Regression & integrasi akhir |

---

### Task 1: Model Metadata Pesan (token + biaya)

**Files:**
- Modify: `js/sessions.js`
- Test: `tests/metadata.test.mjs`

**Interfaces:**
- Consumes: `createSession`, `syncSession` (struktur pesan `{role, text, hidden?, label?, kind?, sources?}`).
- Produces: field opsional baru di setiap pesan model → `tokens?: {prompt, completion, total}`, `cost?: number`, `model?: string`.

**Konteks:** `state.messages` adalah array hidup; disimpan ke localStorage lewat `syncSession`. Field baru harus *survive* simpan/muat sesi (redo/edit & refresh). `deriveTitle` tidak terpengaruh (hanya baca `role/user`).

- [ ] **Step 1: Write the failing test**

```js
// tests/metadata.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, syncSession } from '../js/sessions.js';

test('syncSession: menyimpan field metadata token & biaya', () => {
  const s = createSession(1);
  const msgs = [
    { role: 'user', text: 'hai' },
    { role: 'model', text: 'halo', tokens: { prompt: 10, completion: 5, total: 15 }, cost: 0.02, model: 'gemini-3.8-flash' },
  ];
  const r = syncSession(s, { messages: msgs, startedAt: 5, files: [], activeMs: 0 }, 9);
  assert.deepEqual(r.messages[1].tokens, { prompt: 10, completion: 5, total: 15 });
  assert.equal(r.messages[1].cost, 0.02);
  assert.equal(r.messages[1].model, 'gemini-3.8-flash');
});

test('syncSession: metadata opsional (tanpa field pun tetap aman)', () => {
  const s = createSession(1);
  const r = syncSession(s, { messages: [{ role: 'user', text: 'x' }], startedAt: 5, files: [] }, 9);
  assert.equal(r.messages[0].tokens, undefined);
  assert.equal(r.messages[0].cost, undefined);
});

test('createSession: struktur dasar tidak berubah (backward compatible)', () => {
  const s = createSession(1000);
  assert.deepEqual(Object.keys(s).sort(), ['activeMs', 'files', 'id', 'messages', 'startedAt', 'title', 'updatedAt'].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/metadata.test.mjs`
Expected: FAIL — `r.messages[1].tokens` adalah `undefined` (field belum ada di data yang lewat).

- [ ] **Step 3: Write minimal implementation**

Di `js/sessions.js`, `syncSession` sudah mengembalikan `{...session, messages: [...messages], ...}`. Karena `[...messages]` menyalin referensi objek, field metadata yang menempel pada tiap pesan **sudah ikut tersimpan**. Yang perlu dijamin: `createSession` tidak menghapus/menimpa; dan `syncSession` harus *menyatu-ratakan* (normalize) agar pesan legacy tanpa field tetap valid. Tambahkan helper normalize ringan:

```js
// js/sessions.js — tambahkan setelah deriveTitle()
export function normalizeMessage(m) {
  if (!m || typeof m.text !== 'string') return null;
  return {
    role: m.role === 'model' ? 'model' : m.role === 'error' ? 'error' : 'user',
    text: m.text,
    hidden: m.hidden === true ? true : undefined,
    label: typeof m.label === 'string' ? m.label : undefined,
    kind: m.kind || undefined,
    model: typeof m.model === 'string' ? m.model : undefined,
    tokens: m.tokens && typeof m.tokens === 'object' ? m.tokens : undefined,
    cost: typeof m.cost === 'number' ? m.cost : undefined,
    sources: Array.isArray(m.sources) ? m.sources : undefined,
  };
}
```

Ubah `syncSession` agar menyalin lewat `normalizeMessage` (filter yang rusak):

```js
export function syncSession(session, { messages, startedAt, files, activeMs }, now = Date.now()) {
  const normalized = (messages || []).map(normalizeMessage).filter(Boolean);
  return {
    ...session,
    messages: normalized,
    files: files ? [...files] : session.files || [],
    startedAt,
    activeMs: activeMs ?? session.activeMs ?? 0,
    title: deriveTitle(normalized) || session.title || '',
    updatedAt: now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/metadata.test.mjs`
Expected: PASS (3 test). Jalankan juga `node --test tests/core.test.mjs` → tetap 20/20.

- [ ] **Step 5: Commit**

```bash
git add js/sessions.js tests/metadata.test.mjs
git commit -m "feat(sessions): tambahkan metadata token & biaya ke pesan"
```

---

### Task 2: Fungsi Murni Redo/Edit (`js/redo.js`)

**Files:**
- Create: `js/redo.js`
- Test: `tests/redo.test.mjs`

**Interfaces:**
- Consumes: array pesan `{role:'user'|'model', text, ...}` (sama dengan `buildContents` di app.js).
- Produces:
  - `planRedo(messages)` → `{ modelIndex, contents } | null`. `contents` = array `{role, text}` dari semua pesan **sebelum** balasan model terakhir (yang akan diganti). `modelIndex` = indeks balasan model terakhir.
  - `planEdit(messages, editIdx)` → `{ contents, firstModelIndex }`. `contents` = array `{role, text}` sampai & termasuk pesan user yang disunting di `editIdx`; `firstModelIndex` = indeks balasan model pertama **setelah** titik sunting (untuk mulai regenerasi berurutan).

**Konteks:** app.js punya `buildContents()` yang mem-filter `user|model`. Fungsi di sini mirip tapi untuk *slicing* redo/edit. Harus murni (tanpa DOM) agar teruji.

- [ ] **Step 1: Write the failing test**

```js
// tests/redo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { planRedo, planEdit } from '../js/redo.js';

const msgs = [
  { role: 'user', text: 'Q1' },
  { role: 'model', text: 'A1' },
  { role: 'user', text: 'Q2' },
  { role: 'model', text: 'A2' }, // balasan terakhir
];

test('planRedo: isi contents = semua sebelum balasan model terakhir', () => {
  const p = planRedo(msgs);
  assert.equal(p.modelIndex, 3);
  assert.deepEqual(p.contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ]);
});

test('planRedo: null bila tak ada balasan model', () => {
  assert.equal(planRedo([{ role: 'user', text: 'Q' }]), null);
  assert.equal(planRedo([]), null);
});

test('planEdit: contents sampai & termasuk user yang disunting, firstModelIndex setelahnya', () => {
  // sunting Q1 (idx 0) → regenerasi A1 (idx1) & A2 (idx3)
  const p = planEdit(msgs, 0);
  assert.deepEqual(p.contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ]);
  assert.equal(p.firstModelIndex, 1);
});

test('planEdit: sunting Q2 (idx2) → regenerasi A2 saja', () => {
  const p = planEdit(msgs, 2);
  assert.deepEqual(p.contents, [{ role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }, { role: 'user', text: 'Q2' }]);
  assert.equal(p.firstModelIndex, 3);
});

test('planRedo/edit: abaikan pesan hidden & non-user/model', () => {
  const mixed = [
    { role: 'system', text: 'catatan', hidden: true },
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
  ];
  const p = planRedo(mixed);
  assert.deepEqual(p.contents, [{ role: 'user', text: 'Q1' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/redo.test.mjs`
Expected: FAIL — "planRedo is not a function" / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// js/redo.js
// Fungsi murni untuk merencanakan regenerasi balasan (redo) & sunting pesan (edit).
// Tidak menyentuh DOM; hanya memotong array pesan → {role, text}.

function toContents(list) {
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'model'))
    .map((m) => ({ role: m.role, text: m.text }));
}

// REDO: regenerasi balasan model terakhir.
export function planRedo(messages) {
  let modelIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'model') { modelIndex = i; break; }
  }
  if (modelIndex < 0) return null;
  return { modelIndex, contents: toContents(messages.slice(0, modelIndex)) };
}

// EDIT: sunting pesan user pada editIdx → regenerasi ke belakang.
// contents = sampai & termasuk user yang disunting; firstModelIndex = balasan model pertama setelahnya.
export function planEdit(messages, editIdx) {
  const upTo = messages.slice(0, editIdx + 1);
  let firstModelIndex = -1;
  for (let i = editIdx + 1; i < messages.length; i += 1) {
    if (messages[i].role === 'model') { firstModelIndex = i; break; }
  }
  return { contents: toContents(upTo), firstModelIndex };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/redo.test.mjs`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add js/redo.js tests/redo.test.mjs
git commit -m "feat(redo): tambahkan fungsi murni planRedo & planEdit"
```

---

### Task 3: Tombol Regenerasi (Redo) di Bubble Tutor

**Files:**
- Modify: `js/chat.js` (tambah tombol regenerasi ke footer bubble model), `js/app.js` (handler + panggil `planRedo`)
- Test: manual/Playwright (bagian DOM — lihat Step 5)

**Interfaces:**
- Consumes: `planRedo(messages)` dari Task 2; `callGemini`/`providerChat`; `streamReply`.
- Produces: tombol `<button class="msg__action" data-action="redo">` di footer bubble model → saat diklik regenerasi balasan terakhir.

**Konteks:** Bubble model dibuat oleh `addModelMessage()` → `{msg, content}`; footer (sumber) ditambahkan `renderSources()`. Kita tambahkan baris footer aksi *sebelum/sesudah* sumber. app.js melacak `state.messages`; redo = panggil API dengan `planRedo.contents`, ganti `state.messages[modelIndex]`, stream ulang.

- [ ] **Step 1: Write the failing test (pure wiring helper)**

Ekstrak logika "bangun array isi untuk redo" agar teruji; sisanya (DOM) diuji manual. Tambahkan export kecil di `js/redo.js`:

```js
// js/redo.js — tambahkan di akhir file
// Gabungkan hasil redo ke state: kembalikan index model + contents baru.
export function applyRedo(messages, plan) {
  // messages: array hidup; plan = planRedo result.
  // Return: { contents, modelIndex } untuk dipakai caller (app.js) memanggil API.
  return plan ? { contents: plan.contents, modelIndex: plan.modelIndex } : null;
}
```

Test:

```js
// tests/redo.test.mjs — tambahkan di akhir
import { applyRedo } from '../js/redo.js';

test('applyRedo: membungkus plan menjadi instruksi regenerasi', () => {
  const msgs = [{ role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }];
  const plan = applyRedo(msgs, planRedo(msgs));
  assert.equal(plan.modelIndex, 1);
  assert.deepEqual(plan.contents, [{ role: 'user', text: 'Q1' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/redo.test.mjs`
Expected: FAIL — "applyRedo is not a function".

- [ ] **Step 3: Write minimal implementation (chat.js)**

Tambahkan fungsi pembangun footer aksi di `js/chat.js`, dan panggil dari app.js saat menambah bubble model. Tambahkan export `addModelMessageWithActions`? Lebih ringkas: ubah `addModelMessage` agar opsional menyertakan tombol redo. Karena `renderSources` sudah menempelkan elemen ke `.msg__col`, kita tempatkan tombol aksi di atas blok sumber.

```js
// js/chat.js — tambahkan setelah renderSources()
const REDO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

export function addRedoButton(col, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg__action btn btn--ghost btn--sm';
  btn.setAttribute('aria-label', 'Regenerasi balasan tutor');
  btn.innerHTML = REDO_ICON;
  btn.addEventListener('click', onClick);
  col.insertBefore(btn, col.firstChild);
  return btn;
}
```

- [ ] **Step 4: Write app.js handler**

Di `js/app.js`, modifikasi alur penambahan bubble model. Tambahkan import `planRedo`/`applyRedo`; buat fungsi `regenerateLast()`:

```js
// js/app.js — tambahkan setelah streamReply(), sebelum drawer pengaturan
async function regenerateLast() {
  if (state.busy) { showToast('Tunggu balasan tutor selesai dulu, ya.', 'info'); return; }
  const plan = applyRedo(state.messages, planRedo(state.messages));
  if (!plan) { showToast('Belum ada balasan untuk diregenerasi.', 'info'); return; }

  state.busy = true;
  updateComposer();
  const typing = showTyping(dom.messages);
  scrollToEnd(dom.chatScroll, true);

  try {
    const { text: reply, sources, tokens } = await providerChat({
      systemPrompt: buildSystemPrompt({
        materi: buildMateri(),
        mode: state.settings.mode,
        level: state.settings.level,
        webSearch: state.settings.webSearch,
      }),
      contents: plan.contents,
      model: state.settings.model,
      thinkingLevel: thinkingLevelFor(),
      grounding: state.settings.webSearch,
    });
    removeTyping(typing);
    // Ganti balasan model terakhir + simpan metadata.
    const prev = state.messages[plan.modelIndex];
    state.messages[plan.modelIndex] = {
      ...prev,
      text: reply,
      sources,
      tokens: tokens || prev.tokens,
      cost: prev ? computeCost(prev) : undefined,
    };
    // Render ulang bubble model terakhir (hapus typing → rebuild).
    rerenderModelMessage(plan.modelIndex);
  } catch (err) {
    removeTyping(typing);
    state.busy = false;
    const text = errorDisplayText(err);
    addNotice(dom.messages, text, 'error');
    showToast(text, 'error');
    logApiError(err);
  } finally {
    updateComposer();
    saveActiveSession();
  }
}
```

> Catatan: `providerChat` & `computeCost` didefinisikan pada Task 5 & 8. Untuk membuat Task 3 mandiri, **sementara** gunakan `callGemini` (yang sudah ada) + `cost = undefined`. Ganti ke `providerChat`/`computeCost` saat fasa P2/P3. `rerenderModelMessage` = hapus bubble model terakhir dari DOM lalu render ulang dari `state.messages[modelIndex]` lewat `addModelMessage`+`renderRich`+`renderSources`.

- [ ] **Step 5: Wire tombol ke bubble + verifikasi manual**

Di `addModelMessage`, panggil `addRedoButton(col, regenerateLast)` agar setiap bubble model punya tombol redo. Karena `regenerateLast` butuh DOM & state, bind di app.js setelah bubble dibuat. Verifikasi manual (Playwright):

```bash
# 1) jalankan server: python3 -m http.server 5500 (di root proyek)
# 2) buka http://127.0.0.1:5500, isi key + materi, kirim 1 pesan
# 3) klik tombol "Regenerasi" di bubble tutor → balasan baru muncul, riwayat tetap
```

- [ ] **Step 6: Commit**

```bash
git add js/chat.js js/app.js
git commit -m "feat(chat): tambahkan tombol regenerasi (redo) di bubble tutor"
```

---

### Task 4: Tombol Sunting (Edit) + Regenerasi ke Belakang

**Files:**
- Modify: `js/chat.js` (tombol edit di pesan user + sunting inline), `js/app.js` (`regenerateFrom`)
- Test: manual/Playwright

**Interfaces:**
- Consumes: `planEdit(messages, idx)` dari Task 2.
- Produces: tombol "Sunting" di bubble user → textarea inline → regenerasi semua balasan model setelahnya (urutan).

**Konteks:** `addUserMessage(root, text)` membuat bubble user. Kita tambahkan tombol edit + overlay sunting. Edit = rebuild isi sampai & termasuk user yang disunting (`planEdit.contents`), lalu regenerasi berurutan mulai `firstModelIndex`: untuk setiap balasan model berikutnya, panggil API dengan contents berjalan, ganti isinya, lanjut ke user-prompt berikutnya (yang sudah tetap).

- [ ] **Step 1: Write the failing test (pure loop planner)**

Tambahkan di `js/redo.js` fungsi yang menghitung *urutan regenerasi* edit sebagai array instruksi (murni, teruji):

```js
// js/redo.js — tambahkan
// Hitung daftar "giliran" regenerasi untuk EDIT: setiap item = contents + target index model.
export function planEditRegenerations(messages, editIdx) {
  const base = messages.slice(0, editIdx + 1); // sampai & termasuk user yang disunting
  const regs = [];
  let cursor = editIdx + 1;
  let contents = toContents(base);
  // Kumpulkan model + user-prompt berikutnya secara berurutan.
  while (cursor < messages.length) {
    if (messages[cursor].role === 'model') {
      regs.push({ contents: contents.map((c) => ({ ...c })), modelIndex: cursor });
      contents = [...contents, { role: 'model', text: messages[cursor].text || '' }];
      cursor += 1;
    } else if (messages[cursor].role === 'user') {
      contents = [...contents, { role: 'user', text: messages[cursor].text }];
      cursor += 1;
    } else {
      cursor += 1; // abaikan system/notice
    }
  }
  return regs;
}
```

Test:

```js
// tests/redo.test.mjs — tambahkan
import { planEditRegenerations } from '../js/redo.js';

test('planEditRegenerations: urutan regenerasi multi-turn setelah edit', () => {
  const msgs = [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
    { role: 'model', text: 'A2' },
  ];
  const regs = planEditRegenerations(msgs, 0); // sunting Q1
  assert.equal(regs.length, 2);
  // Reg #1: isi sampai Q1 (+ A1 lama sebagai konteks), target model idx1
  assert.deepEqual(regs[0].contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
  ]);
  assert.equal(regs[0].modelIndex, 1);
  // Reg #2: isi sampai Q2 (dengan A1 baru), target model idx3
  assert.deepEqual(regs[1].contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ]);
  assert.equal(regs[1].modelIndex, 3);
});

test('planEditRegenerations: sunting balikan terakhir hanya 1 reg', () => {
  const msgs = [{ role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }];
  assert.equal(planEditRegenerations(msgs, 0).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/redo.test.mjs`
Expected: FAIL — "planEditRegenerations is not a function".

- [ ] **Step 3: Write minimal implementation (chat.js)**

Tambahkan tombol edit + modal sunting inline di `js/chat.js`:

```js
// js/chat.js — tambahkan setelah addUserMessage()
const EDIT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

export function addUserMessageWithEdit(root, text, onEdit) {
  removeEmptyState(root);
  const msg = document.createElement('div');
  msg.className = 'msg msg--user';
  msg.appendChild(avatar('K'));
  const { col, content } = makeColumn('Kamu');

  // Area teks (bisa diedit) — simpan text asli di dataset.
  content.setAttribute('contenteditable', 'true');
  content.classList.add('msg__content--editable');
  content.textContent = text;
  content.dataset.original = text;

  if (typeof onEdit === 'function') {
    const bar = document.createElement('div');
    bar.className = 'msg__actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg__action btn btn--ghost btn--sm';
    btn.setAttribute('aria-label', 'Sunting pertanyaan');
    btn.innerHTML = EDIT_ICON;
    btn.addEventListener('click', () => onEdit(content));
    bar.appendChild(btn);
    col.appendChild(bar);
  }
  msg.appendChild(col);
  root.appendChild(msg);
  return msg;
}
```

> Catatan: `addUserMessage` asli tetap dipakai untuk restore dari riwayat (agar tidak double-edit). Untuk pesan hasil ketik langsung, panggil `addUserMessageWithEdit`. Simpan ref `onEdit` per bubble via closure.

- [ ] **Step 4: Write app.js handler regenerateFrom**

```js
// js/app.js — tambahkan setelah regenerateLast()
async function regenerateFrom(editIdx) {
  if (state.busy) { showToast('Tunggu balasan tutor selesai dulu, ya.', 'info'); return; }
  const regs = planEditRegenerations(state.messages, editIdx);
  if (!regs.length) { showToast('Tidak ada balasan untuk diregenerasi.', 'info'); return; }

  state.busy = true;
  updateComposer();
  scrollToEnd(dom.chatScroll, true);

  // Hapus bubble model lama setelah editIdx (render ulang berurutan).
  const systemPrompt = () => buildSystemPrompt({
    materi: buildMateri(),
    mode: state.settings.mode,
    level: state.settings.level,
    webSearch: state.settings.webSearch,
  });

  try {
    for (const reg of regs) {
      const { text: reply, sources, tokens } = await providerChat({
        systemPrompt: systemPrompt(),
        contents: reg.contents,
        model: state.settings.model,
        thinkingLevel: thinkingLevelFor(),
        grounding: state.settings.webSearch,
      });
      // Ganti isi model di reg.modelIndex + metadata.
      const prev = state.messages[reg.modelIndex];
      state.messages[reg.modelIndex] = {
        ...prev,
        text: reply,
        sources,
        tokens: tokens || prev.tokens,
        cost: prev ? computeCost(prev) : undefined,
      };
    }
    // Render ulang semua bubble model dari editIdx ke akhir.
    rerenderModelMessagesFrom(editIdx);
  } catch (err) {
    state.busy = false;
    const text = errorDisplayText(err);
    addNotice(dom.messages, text, 'error');
    showToast(text, 'error');
    logApiError(err);
  } finally {
    updateComposer();
    saveActiveSession();
  }
}
```

> `rerenderModelMessagesFrom(startIdx)`: hapus semua bubble model di DOM dengan index ≥ startIdx dari `state.messages`, lalu render ulang satu per satu via `addModelMessage`+`renderRich`+`renderSources`+`addRedoButton`. Untuk Task 4, implementasikan versi sederhana: `clearMessages` + render ulang seluruh `state.messages` (benar, sedikit kurang efisien; cukup untuk MVP).

- [ ] **Step 5: Verifikasi manual**

Buka app → sunting pertanyaan pertama → semua balasan tutor setelahnya regenerasi berurutan → riwayat tetap. Cek 0 error console.

- [ ] **Step 6: Commit**

```bash
git add js/chat.js js/app.js tests/redo.test.mjs
git commit -m "feat(chat): tambahkan sunting pesan + regenerasi ke belakang (edit)"
```

---

### Task 5: Provider Registry + listModels (`js/providers.js`)

**Files:**
- Create: `js/providers.js`
- Test: `tests/providers.test.mjs`

**Interfaces:**
- Produces:
  - `PROVIDERS` = `{ gemini: { id, name, baseUrl, modelsPath, chatPath, authHeader, supportsGrounding, supportsThinking } }`.
  - `listModels(apiKey, provider)` → `Promise<string[]>` (id model chat-capable). GET `${baseUrl}${modelsPath}` + header auth; filter: ikut bila `capabilities` tidak ada **atau** includes `'chat/completions'`; buang bila `owned_by === 'embedding'` atau capabilities hanya embedding.
  - `resolveProviders(custom)` → gabung default + custom (array dari settings) → registry by id.
- Consumes: `mapApiError` dari `api.js`.

**Konteks:** Gemini lewat adapter OpenAI (`/openai/models`, `/openai/chat/completions`) dengan header `x-goog-api-key`. Endpoint custom: user isi `baseUrl` + opsional `authHeader` (default `Authorization: Bearer`). Daftar model **otomatis** menyesuaikan endpoint.

- [ ] **Step 1: Write the failing test**

```js
// tests/providers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, listModels, resolveProviders } from '../js/providers.js';

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  return calls;
}
const okRes = (json) => ({ ok: true, status: 200, json: async () => json });

test('PROVIDERS.gemini: path adapter OpenAI + header x-goog-api-key', () => {
  assert.equal(PROVIDERS.gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(PROVIDERS.gemini.modelsPath, '/openai/models');
  assert.equal(PROVIDERS.gemini.chatPath, '/openai/chat/completions');
  assert.equal(PROVIDERS.gemini.authHeader, 'x-goog-api-key');
  assert.equal(PROVIDERS.gemini.supportsGrounding, true);
  assert.equal(PROVIDERS.gemini.supportsThinking, true);
});

test('listModels: GET ke modelsPath + header auth + filter chat-capable', async () => {
  const calls = stubFetch(() => okRes({ data: [
    { id: 'gpt-4o', owned_by: 'openai' },                       // tanpa capabilities → ikut
    { id: 'gpt-4o', capabilities: ['chat/completions'] },        // eksplisit chat → ikut (duplikat di-dedup)
    { id: 'text-embedding-003', owned_by: 'openai', capabilities: ['embedding'] }, // embedding saja → buang
    { id: 'qwen-max' },                                          // tanpa fields → ikut
  ] }));
  const ids = await listModels('K', PROVIDERS.gemini);
  assert.deepEqual(ids, ['gpt-4o', 'qwen-max']);
  assert.equal(calls[0].url, `${PROVIDERS.gemini.baseUrl}${PROVIDERS.gemini.modelsPath}`);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'K');
});

test('listModels: offline → lempar error ramah (network)', async () => {
  stubFetch(() => { throw new Error('offline'); });
  await assert.rejects(() => listModels('K', PROVIDERS.gemini), (e) => e.type === 'network');
});

test('resolveProviders: gabung default + custom', () => {
  const custom = [{ id: 'local', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' }];
  const all = resolveProviders(custom);
  assert.equal(all.gemini.id, 'gemini');
  assert.equal(all.local.baseUrl, 'http://localhost:11434/v1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/providers.test.mjs`
Expected: FAIL — module/functions not found.

- [ ] **Step 3: Write minimal implementation**

```js
// js/providers.js
import { mapApiError } from './api.js';

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Gemini (default)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsPath: '/openai/models',
    chatPath: '/openai/chat/completions',
    authHeader: 'x-goog-api-key',
    supportsGrounding: true,
    supportsThinking: true,
  },
};

// Registry = default + custom (array dari settings.providers).
export function resolveProviders(custom = []) {
  const all = { ...PROVIDERS };
  for (const p of custom) {
    if (p && p.id && p.baseUrl) all[p.id] = { ...p, custom: true };
  }
  return all;
}

function authHeader(provider, apiKey) {
  // Header khusus provider (mis. x-goog-api-key) atau Bearer default.
  if (provider.authHeader === 'x-goog-api-key') return { [provider.authHeader]: apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}

export async function listModels(apiKey, provider = PROVIDERS.gemini) {
  let res;
  try {
    res = await fetch(`${provider.baseUrl}${provider.modelsPath}`, { headers: authHeader(provider, apiKey) });
  } catch {
    throw { ...mapApiError(0) };
  }
  if (!res.ok) {
    let apiMessage = '';
    try { apiMessage = (await res.json()).error?.message || ''; } catch {}
    throw { ...mapApiError(res.status, apiMessage) };
  }
  const data = await res.json();
  const list = data.data || [];
  const seen = new Set();
  const ids = [];
  for (const m of list) {
    const caps = m.capabilities || [];
    const isEmbeddingOnly = caps.length > 0 && !caps.includes('chat/completions');
    if (m.owned_by === 'embedding' || isEmbeddingOnly) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    ids.push(m.id);
  }
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/providers.test.mjs`
Expected: PASS (4 test). Regression: `node --test tests/core.test.mjs` tetap 20/20.

- [ ] **Step 5: Commit**

```bash
git add js/providers.js tests/providers.test.mjs
git commit -m "feat(providers): registry + listModels OpenAI-compatible"
```

---

### Task 6: chatCompletion (OpenAI path) + Source Extraction

**Files:**
- Modify: `js/providers.js` (tambah `chatCompletion`)
- Test: `tests/providers.test.mjs` (tambahkan test)

**Interfaces:**
- Produces: `chatCompletion({ provider, apiKey, model, systemPrompt, contents, maxTokens, thinkingLevel, grounding })` → `Promise<{ text, tokens:{prompt,completion,total}, sources }>`.
  - POST `${baseUrl}${chatPath}` body `{ model, messages, max_tokens, tools? (grounding), reasoning_effort/thinking? }`.
  - `messages`: `systemPrompt`→`{role:'system'}`, user→`{role:'user', content}`, model→`{role:'assistant', content}`.
  - Parse `choices[0].message.content` + `usage.{prompt,completion,total}_tokens`.
  - `sources`: bila response punya `candidates[].groundingMetadata` (Gemini) → `extractSources`; bila `tool_calls`/`citations` → map sederhana; else `[]`.
  - **Graceful degradation grounding:** bila `supportsGrounding` & response error karena `tools`, retry tanpa `tools`.

**Konteks:** Reuse `extractSources` + `mapApiError` dari `api.js`. Token keluar = `usage.completion_tokens`.

- [ ] **Step 1: Write the failing test**

```js
// tests/providers.test.mjs — tambahkan
import { chatCompletion } from '../js/providers.js';
import { extractSources } from '../js/api.js';

test('chatCompletion: POST format OpenAI + parse content & usage', async () => {
  const calls = stubFetch(() => okRes({
    choices: [{ message: { role: 'assistant', content: ' Halo dunia ' } }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  }));
  const r = await chatCompletion({
    provider: PROVIDERS.gemini, apiKey: 'K', model: 'gemini-3.8-flash',
    systemPrompt: 'sys', contents: [{ role: 'user', text: 'hi' }],
  });
  assert.equal(r.text, 'Halo dunia');
  assert.deepEqual(r.tokens, { prompt: 12, completion: 8, total: 20 });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);
  assert.ok(calls[0].init.headers['x-goog-api-key'] === 'K');
});

test('chatCompletion: grounding → tools bila didukung, fallback tanpa tools', async () => {
  // Percobaan 1: tools diterima.
  let n = 0;
  globalThis.fetch = async (url, init) => {
    n += 1;
    const body = JSON.parse(init.body);
    if (n === 1 && body.tools) return okRes({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 5 } });
    if (n === 2 && !body.tools) return okRes({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 5 } });
    return okRes({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 5 } });
  };
  const r = await chatCompletion({
    provider: PROVIDERS.gemini, apiKey: 'K', model: 'gemini-3.8-flash',
    systemPrompt: 's', contents: [{ role: 'user', text: 'x' }], grounding: true,
  });
  assert.equal(r.text, 'ok');
});

test('chatCompletion: sources dari groundingMetadata (Gemini)', async () => {
  globalThis.fetch = async () => okRes({
    choices: [{ message: { content: 'jawaban' } }],
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://a.id', title: 'A' } }] } }],
  });
  const r = await chatCompletion({ provider: PROVIDERS.gemini, apiKey: 'K', model: 'm', systemPrompt: 's', contents: [{ role: 'user', text: 'x' }] });
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].url, 'https://a.id');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/providers.test.mjs`
Expected: FAIL — "chatCompletion is not a function".

- [ ] **Step 3: Write minimal implementation**

Tambahkan di `js/providers.js`:

```js
export async function chatCompletion({
  provider = PROVIDERS.gemini, apiKey, model, systemPrompt, contents,
  maxTokens = 8192, thinkingLevel, grounding,
}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (const m of contents || []) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text });

  const body = { model, messages, max_tokens: maxTokens };
  if (provider.supportsThinking && thinkingLevel) {
    body.generationConfig = { thinkingLevel }; // Gemini adapter; provider lain abaikan
  }
  let res;
  try {
    res = await buildChatRequest(provider, apiKey, body, grounding);
  } catch (err) {
    throw err;
  }

  if (!res.ok) {
    let apiMessage = '';
    try { apiMessage = (await res.json()).error?.message || ''; } catch {}
    // Graceful degradation: tools → coba ulang tanpa tools bila request-ditolak.
    const body2 = JSON.parse(body);
    const withoutTools = { ...body2 };
    delete withoutTools.tools;
    if ((res.status === 400 || res.status === 422) && body.tools && !withoutTools.tools) {
      try {
        res = await fetch(`${provider.baseUrl}${provider.chatPath}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(provider, apiKey) },
          body: JSON.stringify(withoutTools),
        });
      } catch { throw { ...mapApiError(0) }; }
    }
    if (!res.ok) throw { ...mapApiError(res.status, apiMessage) };
  }

  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const text = (choice && choice.message && choice.message.content) || '';
  const usage = data.usage || {};
  const tokens = {
    prompt: usage.prompt_tokens ?? undefined,
    completion: usage.completion_tokens ?? undefined,
    total: usage.total_tokens ?? undefined,
  };
  let sources = [];
  if (data.candidates) sources = extractSources(data.candidates[0]);
  return { text: text.trim(), tokens, sources };
}

async function buildChatRequest(provider, apiKey, body, grounding) {
  if (grounding && provider.supportsGrounding) body.tools = [{ type: 'function', function: { name: 'google_search', description: 'web grounding' } }];
  return fetch(`${provider.baseUrl}${provider.chatPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(provider, apiKey) },
    body: JSON.stringify(body),
  });
}

// Convenience untuk app.js: providerChat('gemini', params) → chatCompletion.
export async function providerChat(providerName, params = {}) {
  const providers = resolveProviders(params.customProviders || []);
  return chatCompletion({ provider: providers[providerName] || PROVIDERS.gemini, ...params });
}
```

> Catatan: `JSON.parse(body)` di atas karena `body` objek (bukan string). Untuk kejelasan, simpan `const bodyStr = JSON.stringify(body)` & kirim `bodyStr`, lalu parse ulang untuk fallback. Sesuaikan agar test grounding-pass-through tetap valid (test hanya cek saat n===1 tools ada).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/providers.test.mjs`
Expected: PASS (semua). Regression core.test.mjs tetap hijau.

- [ ] **Step 5: Commit**

```bash
git add js/providers.js tests/providers.test.mjs
git commit -m "feat(providers): chatCompletion OpenAI + ekstraksi sumber + graceful degradation"
```

---

### Task 7: Section Provider di Drawer + Refresh Dropdown Model

**Files:**
- Modify: `index.html` (tambah section Provider), `js/config.js` (STORAGE_KEYS.provider, providers default), `js/app.js` (bind + refresh model dropdown)
- Test: manual/Playwright

**Interfaces:**
- Consumes: `resolveProviders`, `listModels` dari Task 5.
- Produces: `<section class="panel" id="providerPanel">` dengan `select#providerSelect`, `input#customBaseUrl`, `input#customAuthHeader`, `button#addCustomProvider`; dropdown model (`#modelSelect`) diisi ulang tiap ganti provider/kunci.

**Konteks:** Drawer sudah punya section "Kunci API", "Materi", "Pengaturan Belajar". Tambah section Provider **setelah** Kunci API (sebelum `<div class="panel__divider">` pertama). Simpan custom providers di `settings.providers` (localStorage). Ganti provider → `listModels` → isi `#modelSelect`.

- [ ] **Step 1: HTML — tambah section Provider**

Sisipkan setelah section "Kunci API" (line ~204) dan sebelum `<div class="panel__divider">`:

```html
<!-- PROVIDER -->
<section class="panel" aria-labelledby="panel-provider-title">
  <div class="panel__header">
    <h2 class="panel__title" id="panel-provider-title">Provider</h2>
  </div>
  <div class="field">
    <label class="field__label" for="providerSelect">Model Provider</label>
    <select id="providerSelect" class="select"></select>
    <p class="field__hint">Daftar model menyesuaikan endpoint & kunci yang dipakai. Gemini tetap default.</p>
  </div>
  <div class="field">
    <label class="field__label" for="customBaseUrl">Endpoint Custom (OpenAI-compatible)</label>
    <input id="customBaseUrl" class="input" type="text" placeholder="https://api.groq.com/openai/v1" autocomplete="off" spellcheck="false" />
    <input id="customAuthHeader" class="input" type="text" placeholder="Header auth (opsional, mis. Bearer)" autocomplete="off" spellcheck="false" style="margin-top:var(--space-2)" />
    <button id="addCustomProvider" class="btn btn--ghost btn--sm" type="button" style="margin-top:var(--space-2)">Tambah endpoint</button>
    <p class="field__hint">Grounding &amp; penalaran hanya aktif di provider yang mendukung (default Gemini).</p>
  </div>
</section>

<div class="panel__divider" role="separator"></div>
```

- [ ] **Step 2: config.js — storage key + default providers**

Tambahkan `STORAGE_KEYS.provider = 'tanyabukan.provider'`. (Custom provider array disimpan di `settings.providers`.)

- [ ] **Step 3: app.js — bind + refresh**

Import `resolveProviders`, `listModels`; tambahkan `dom.providerSelect`, `dom.customBaseUrl`, `dom.customAuthHeader`, `dom.addCustomProvider`. Tambahkan:

```js
function currentProviders() { return resolveProviders(state.settings.providers || []); }

async function refreshProviderModelList() {
  if (!state.apiKey) return;
  const providers = currentProviders();
  const providerId = state.settings.provider || 'gemini';
  const provider = providers[providerId];
  if (!provider) return;
  try {
    const ids = await listModels(state.apiKey, provider);
    if (!ids.length) return;
    dom.model.innerHTML = ids.map((id) => `<option value="${id}">${id}</option>`).join('');
    dom.model.value = ids.includes(state.settings.model) ? state.settings.model : ids[0];
    state.settings.model = dom.model.value;
    persistSettings();
  } catch (err) {
    console.warn('[TanyaBukan] gagal memuat daftar model provider:', err?.message);
  }
}

function renderProviderOptions() {
  const providers = currentProviders();
  dom.providerSelect.innerHTML = Object.values(providers)
    .map((p) => `<option value="${p.id}" ${p.id === state.settings.provider ? 'selected' : ''}>${p.name}</option>`)
    .join('');
}

function addCustomProvider() {
  const baseUrl = dom.customBaseUrl.value.trim();
  if (!baseUrl) { showToast('Masukkan URL endpoint dulu, ya.', 'info'); return; }
  const id = 'custom-' + Math.random().toString(36).slice(2, 7);
  const provider = {
    id, name: baseUrl, baseUrl,
    authHeader: dom.customAuthHeader.value.trim() || 'Authorization',
    supportsGrounding: false, supportsThinking: false, custom: true,
  };
  state.settings.providers = [...(state.settings.providers || []), provider];
  state.settings.provider = id;
  persistSettings();
  renderProviderOptions();
  refreshProviderModelList();
  dom.customBaseUrl.value = '';
  dom.customAuthHeader.value = '';
  showToast(`Endpoint "${baseUrl}" ditambahkan.`, 'success');
}
```

Bind event di `bindEvents()`:
```js
dom.providerSelect.addEventListener('change', () => { state.settings.provider = dom.providerSelect.value; persistSettings(); refreshProviderModelList(); });
dom.addCustomProvider.addEventListener('click', addCustomProvider);
// Ganti provider/kunci → segarkan dropdown model.
dom.apiKey.addEventListener('input', () => { scheduleModelRefresh(); }); // sudah ada; refreshProviderModelList dipanggil di refreshModelList
```

- [ ] **Step 4: Verifikasi manual**

Buka Pengaturan → pilih provider → dropdown model menyesuaikan; tambah endpoint custom → muncul di list + model refresh. 0 error console.

- [ ] **Step 5: Commit**

```bash
git add index.html js/config.js js/app.js
git commit -m "feat(ui): section Provider + refresh dropdown model otomatis"
```

---

### Task 8: Tabel Harga + `computeCost` (`js/pricing.js`)

**Files:**
- Create: `js/pricing.js`
- Test: `tests/pricing.test.mjs`

**Interfaces:**
- Produces:
  - `PRICES` = object keyed model id (atau prefix) → `{ input, output }` per 1M token USD. Prefix diakhiri `*` (mis. `qwen-*`, `groq-*`).
  - `findPrice(modelId)` → `{ input, output } | null`.
  - `estimateCost(modelId, tokens)` → number = `completionTokens × outputPerM / 1e6` (fokus token keluar). `tokens` bisa `{completion}` atau `{prompt, completion, total}`.
  - `formatCost(usd)` → string `$0.00`.

**Konteks:** Biaya muncul hanya bila `findPrice(modelId)` !== null; model unknown → token saja. `computeCost` di app.js = `estimateCost(state.settings.model, msg.tokens)`.

- [ ] **Step 1: Write the failing test**

```js
// tests/pricing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICES, findPrice, estimateCost, formatCost } from '../js/pricing.js';

test('findPrice: model dikenal + prefix wildcard', () => {
  assert.deepEqual(findPrice('gemini-3.8-flash'), { input: 0.5, output: 4 });
  assert.deepEqual(findPrice('qwen-max'), { input: 0, output: 0 }); // qwen-*
  assert.equal(findPrice('model-tidak-dikenal'), null);
});

test('estimateCost: token keluar × harga output', () => {
  // gemini-3.8-flash output $4/1M → 1.000.000 completion = $4
  assert.equal(estimateCost('gemini-3.8-flash', { completion: 1000000 }), 4);
  assert.equal(estimateCost('gemini-3.8-flash', { prompt: 10, completion: 500 }), 0.002);
  // gratis → $0
  assert.equal(estimateCost('qwen-max', { completion: 9999 }), 0);
});

test('estimateCost: model unknown → null (tampilkan token saja)', () => {
  assert.equal(estimateCost('model-x', { completion: 100 }), null);
});

test('formatCost: 2 desimal dengan $', () => {
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(2.5), '$2.50');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pricing.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// js/pricing.js
// Tabel harga indikatif per 1M token (USD). Fokus: token keluar (completion).
export const PRICES = {
  'gemini-3.8-flash': { input: 0.5, output: 4 },
  'gemini-3.6-flash': { input: 0.3, output: 2.5 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'deepseek-v3': { input: 0.27, output: 1.1 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  // wildcard prefix (diakhiri *):
  'qwen-*': { input: 0, output: 0 },
  'groq-*': { input: 0, output: 0 },
};

export function findPrice(modelId) {
  if (!modelId) return null;
  if (PRICES[modelId]) return PRICES[modelId];
  const prefix = `${modelId.split('-').slice(0, -1).join('-')}-`; // mis. qwen-max → qwen-
  for (const key of Object.keys(PRICES)) {
    if (key.endsWith('*') && modelId.startsWith(key.slice(0, -1))) return PRICES[key];
  }
  return null;
}

export function estimateCost(modelId, tokens = {}) {
  const price = findPrice(modelId);
  if (!price) return null;
  const completion = tokens.completion ?? 0;
  return +(completion * price.output / 1e6).toFixed(6);
}

export function formatCost(usd) {
  return `$${Number(usd).toFixed(2)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pricing.test.mjs`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add js/pricing.js tests/pricing.test.mjs
git commit -m "feat(pricing): tabel harga + estimateCost & formatCost"
```

---

### Task 9: Tampilkan Token + Biaya di Footer & Statistik

**Files:**
- Modify: `js/chat.js` (footer token/biaya), `js/app.js` (`computeCost`, hitung total, bind)
- Test: manual/Playwright

**Interfaces:**
- Consumes: `estimateCost`, `formatCost` dari Task 8; metadata `tokens`/`cost` di pesan (Task 1).
- Produces: footer bubble model → `· N token · ~<biaya>` (biaya hanya bila known); ringkasan total sesi di area statistik/dekat Ekspor.

**Konteks:** `computeCost(msg)` = `estimateCost(state.settings.model, msg.tokens || {})`. Saat model berubah / redo/edit, biaya recomputed. Total = sum `cost` semua pesan model + sum `completionTokens`.

- [ ] **Step 1: app.js — computeCost + total**

Import `estimateCost`, `formatCost`; tambahkan:

```js
function computeCost(msg) {
  return estimateCost(state.settings.model, msg.tokens || {});
}

function sessionStats() {
  const modelMsgs = state.messages.filter((m) => m.role === 'model');
  const totalCompletion = modelMsgs.reduce((n, m) => n + (m.tokens?.completion || 0), 0);
  const totalCost = modelMsgs.reduce((n, m) => {
    const c = m.cost ?? computeCost(m);
    return n + (typeof c === 'number' ? c : 0);
  }, 0);
  return { completion: totalCompletion, cost: totalCost };
}
```

- [ ] **Step 2: chat.js — footer token/biaya**

Tambahkan fungsi tempel footer di bubble model (setelah sumber / di atas):

```js
// js/chat.js — tambahkan setelah addRedoButton()
export function addCostFooter(col, tokens, cost) {
  const foot = document.createElement('div');
  foot.className = 'msg__footer';
  const parts = [];
  if (tokens && typeof tokens.completion === 'number') parts.push(`${tokens.completion.toLocaleString('id-ID')} token`);
  if (typeof cost === 'number') parts.push(`~${formatCostLocal(cost)}`);
  if (!parts.length) return null;
  foot.textContent = parts.join(' · ');
  col.appendChild(foot);
  return foot;
}
function formatCostLocal(usd) { return `$${Number(usd).toFixed(2)}`; }
```

> Catatan: `formatCost` dari pricing.js sudah return `$x.xx`; inline saja agar chat.js tidak import pricing (hindari circular). Bisa juga import `formatCost`.

- [ ] **Step 3: Sambungkan ke render bubble model**

Di `rerenderModelMessage(idx)` / `renderMessagesFromState()`, saat rebuild bubble model: panggil `addRedoButton` + `addCostFooter(msg, msg.tokens, msg.cost ?? computeCost(msg))`. Pastikan footer muncul tiap render (restore sesi & regenerasi).

- [ ] **Step 4: Statistik total**

Di `updateStats()`, tambahkan ringkasan: set text ke elemen statistik (mis. `dom.turns` sudah ada; tambah `#costTotal` baru di HTML dekat Ekspor, atau manfaatkan toast/statistik yang ada). Untuk MVP: tambahkan `<span id="statsCost">` di header/statistik dan set `sessionStats()`.

- [ ] **Step 5: Verifikasi manual**

Kirim pesan → footer bubble: "240 token · $0.01"; ganti model ke yang harganya known → biaya muncul; ringkasan total sesi tampil. 0 error console.

- [ ] **Step 6: Commit**

```bash
git add js/chat.js js/app.js index.html
git commit -m "feat(ui): indikator token + biaya per balasan & total sesi"
```

---

### Task 10: Regression & Integrasi Akhir

**Files:**
- Test: `tests/core.test.mjs` (semua), Playwright manual

**Interfaces:**
- Consumes: seluruh fasa.
- Produces: 20+ test lama + baru lolos; 0 error console/page; semua fitur berjalan end-to-end.

- [ ] **Step 1: Jalankan seluruh suite**

Run: `node --test tests/` (atau `node --test tests/core.test.mjs tests/metadata.test.mjs tests/redo.test.mjs tests/providers.test.mjs tests/pricing.test.mjs`)
Expected: PASS semua; hitung total ≥ 30 test.

- [ ] **Step 2: Verifikasi integrasi end-to-end (Playwright/manual)**

Buka `http://127.0.0.1:5500/`:
1. Onboarding → isi key + materi → kirim pesan.
2. Klik **Regenerasi** di bubble tutor → balasan baru, riwayat tetap.
3. **Sunting** pertanyaan → regenerasi ke belakang.
4. Ganti **Provider** → dropdown model menyesuaikan; tambah endpoint custom.
5. Footer token/biaya tampil sesuai harga model.
6. Buka devtools Console → **0 error**; tab Page → 0 error.

- [ ] **Step 3: Self-review vs spec**

Cek setiap poin spec (§1–§10) punya tugas terkait; scan placeholder (TBD/TODO); konsistensi nama fungsi antar-task (`planRedo`, `planEdit`, `chatCompletion`, `listModels`, `estimateCost`). Fix inline bila ada gap.

- [ ] **Step 4: Commit akhir**

```bash
git add tests/ js/ index.html docs/superpowers/plans/
git commit -m "chore: regression + integrasi enhancement (redo/edit, provider, biaya)"
```

---

## Catatan Eksekusi

- **Urutan wajib:** Task 1 → 2 → 3 → 4 (P1), lalu 5 → 7 (P2), lalu 8 → 9 (P3), terakhir 10. Task 3 sementara pakai `callGemini` + `cost=undefined`; upgrade ke `providerChat`/`computeCost` saat P2/P3 selesai.
- **`rerenderModelMessage` / `rerenderModelMessagesFrom`:** implementasikan dengan hapus bubble model dari DOM (`msg.msg--model`) lalu render ulang dari `state.messages`. Pastikan `renderSources` + `addRedoButton` + `addCostFooter` ikut terpasang ulang.
- **Tanpa backend:** semua penyimpanan di `localStorage` (`tanyabukan.*`). Jangan tambahkan fetch ke server sendiri.
- **Jika ada konflik dengan `buildContents()` eksisting** di app.js: biarkan tetap ada (dipakai alur normal); fungsi redo/edit pakai `toContents` dari `js/redo.js`.
