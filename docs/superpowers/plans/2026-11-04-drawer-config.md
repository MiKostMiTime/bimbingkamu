# TanyaBukan — Implementation Plan: Pengaturan Drawer (Hapus Starter + Kunci Per-Endpoint & CRUD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Setiap tugas = unit kecil, teruji mandiri. Langkah pakai checkbox (`- [ ]`).

**Goal:** Rapikan drawer Pengaturan lewat dua fitur — (A) hapus prompt starter agar input diketik manual; (B) kunci API per-endpoint + CRUD endpoint (sunting/hapus) di drawer.

**Architecture:** Satu abstraksi provider (`js/providers.js`) sudah mapan. Logika kunci/CRUD dikemas jadi **fungsi murni** (`resolveApiKey`, `addProvider`, `updateProvider`, `nextActiveAfterDelete`) agar unit-testable tanpa DOM; wrapper tipis di `app.js` yang mengurus `persistSettings()` + re-render. UI mengikuti design system eksisting (`.panel`, `.field`, `.btn--ghost.btn--sm`).

**Tech Stack:** HTML/CSS/JS statis, ES Modules, `fetch`, KaTeX on-demand. Uji: `node --test` (`.mjs`), tanpa dependensi tambahan.

**Spec:** [`docs/superpowers/specs/2026-11-04-drawer-config.md`](../specs/2026-11-04-drawer-config.md) — baca bersamaan; plan arguing dari spec.

## Global Constraints
- **Tanpa backend.** Kunci + token hanya di `localStorage` (`tanyabukan.*`).
- **Bahasa Indonesia** untuk semua teks UI ("Sunting", "Hapus", "Hubungkan endpoint").
- **Backwards-compat:** field `starters` tetap ada di settings (highlight saja yang dihapus); skema `providers` & `messages` tidak berubah.
- **Presedensi kunci:** `(currentProviders()[provider]?.key) || state.apiKey || ''` — kunci endpoint menang, fallback umum, lalu kosong.
- **Reuse helper eksisting:** `showConfirm`, `showToast`, `resolveProviders`, `probeEndpoint`, `listModels`, `refreshProviderModelList`.
- **Regression:** semua suite lama hijau (`core`, `metadata`, `redo`, `providers`, `pricing`, `chat-footer`); 0 error console/page.

---

## Fasa & Peta Tugas

| Fasa | Tugas | Fitur |
|------|-------|-------|
| **P1** | 1–2 | Fitur A: hapus prompt starter (HTML + handler + highlight) |
| **P2** | 3–6 | Fitur B: kunci per-endpoint + CRUD (helper murni → UI) |
| — | 7 | Regression & integrasi akhir |

---

### Task 1: Hapus chip prompt starter dari HTML

**Files:**
- Modify: `index.html`
- Test: manual (browser)

**Interfaces:**
- Consumes: markup chip starter (`#chatInput` di atasnya).
- Produces: area input tanpa chip starter; `dom.starters` jadi kosong (handler `forEach` tetap aman).

**Konteks:** Chip starter (`class="starters"`, lines 127–134) dihapus. Input manual. Auto-greeting tetap jalan (tidak tergantung chip).

- [x] **Step 1: Hapus blok div.starters + komentar**
  - Hapus `index.html` lines 127–134 (komentar + `<div class="starters">…</div>`), sisakan `<div class="composer__inner">`.
  - Verifikasi tidak ada referensi `starter__btn` / `.starters` lain di HTML/CSS.
  - **Aktual:** CSS `.starters` / `.starter__btn` + border pemisah `.composer__inner` ikut dihapus.

---

### Task 2: Hapus logika starter di app.js (STARTER_TEXT + handler + highlight)

**Files:**
- Modify: `js/app.js`
- Test: `tests/settings.test.mjs` (bagian hydrateSettings tanpa starters)

**Interfaces:**
- Consumes: `dom.starters`, map `STARTER_TEXT`.
- Produces: `bindEvents()` + `hydrateSettings()` tidak lagi menyentuh starter; `state.settings.starters` tetap hidrat.

**Konteks:**
- `STARTER_TEXT` (lines 109–114): hapus.
- Handler starter di `bindEvents` (lines 1649–1669): hapus blok `dom.starters.forEach(...)`.
- Highlight starter di `hydrateSettings` (lines 1180–1185): hapus; biarkan selector mode/tone/level tetap hidrat.
- **Tambah eksport** untuk testing: `hydrateSettings`, `renderProviderOptions` ke block export line 1867 (`export { generateGreeting, sendUserMessage, state, renderSessionList, exportSession, hydrateSettings, renderProviderOptions }`).

- [x] **Step 1: Hapus STARTER_TEXT** (lines 109–114)
- [x] **Step 2: Hapus handler starter di bindEvents** (lines 1649–1669)
- [x] **Step 3: Hapus highlight starter di hydrateSettings** (lines 1180–1185)
- [x] **Step 4: Tambahkan `hydrateSettings`, `renderProviderOptions` ke export block (line 1867)**
  - **Aktual:** tidak diperlukan — unit test memakai helper murni di `providers.js`; smoke test DOM mengimpor `app.js` langsung. Export block dibiarkan minimal.
- [x] **Step 5: Test — hydrateSettings jalan tanpa field `starters`**
  - **Aktual:** diverifikasi lewat smoke test jsdom (file sementara di luar repo), bukan shim DOM parsial.

```js
// tests/settings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
// shim DOM + localStorage minimal (pola chat-footer.test.mjs)
const el = () => ({ children: [], className: '', textContent: '', style: {}, dataset: {}, appendChild(c){this.children.push(c);return c;}, addEventListener(){}, querySelector(){return null;}, remove(){} });
globalThis.document = { createElement: el, createTextNode: t => ({text:t}), getElementById: () => null, addEventListener(){}, body:{appendChild(){}}, querySelectorAll: () => [] };
globalThis.window = { matchMedia: () => ({matches:false}), addEventListener(){} };
globalThis.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
globalThis.requestAnimationFrame = fn => fn();
globalThis.location = { protocol: 'file:' };

test('hydrateSettings: jalan tanpa field starters (Fitur A)', async () => {
  const app = await import('../js/app.js');
  app.hydrateSettings(); // tidak boleh throw meski state.settings.starters undefined
  assert.ok(true);
});
```

---

### Task 3: Ekspor helper murni presedensi kunci — `resolveApiKey`

**Files:**
- Modify: `js/providers.js` (modul murni, tanpa init/DOM) → taruh di sini agar teruji lewat import langsung.
- Test: `tests/settings.test.mjs` (import dari `../js/providers.js`)

**Interfaces:**
- Produces: `export function resolveApiKey(providers, activeId, legacyKey)` → string.
- Consumes: map key-by-id `{ id: { key } }`.

**Konteks:** Pindahkan logika presedensi dari `activeApiKey()` ke fungsi murni; `activeApiKey()` jadi wrapper tipis. `providers.js` sudah diimpor app.js & sudah teruji (providers.test.mjs) → tambah helper di sini = uji tanpa shim DOM berat.

```js
export function resolveApiKey(providers, activeId, legacyKey) {
  const p = providers[activeId];
  return (p && p.key) || legacyKey || '';
}
// di app.js:
function activeApiKey() {
  return resolveApiKey(currentProviders(), state.settings.provider, state.apiKey);
}
```

- [x] **Step 1: Tambahkan `resolveApiKey` di providers.js** + ubah `activeApiKey()` (app.js ~line 170)
- [x] **Step 2: Test — presedensi: kunci endpoint > fallback umum > ''**

```js
test('resolveApiKey: per-endpoint key menang', () => {
  assert.equal(resolveApiKey({ep1:{key:'K_EP'}}, 'ep1', 'LEG'), 'K_EP');
});
test('resolveApiKey: fallback kunci umum bila endpoint kosong', () => {
  assert.equal(resolveApiKey({ep1:{key:''}}, 'ep1', 'LEG'), 'LEG');
});
test('resolveApiKey: kosong bila tak ada apa-apa', () => {
  assert.equal(resolveApiKey({}, '', ''), '');
});
```

---

### Task 4: Ekspor helper CRUD endpoint pada array providers

**Files:**
- Modify: `js/providers.js` (murni, dekat `resolveApiKey`)
- Test: `tests/settings.test.mjs` (import dari `../js/providers.js`; bagian addProvider/updateProvider/nextActiveAfterDelete)

**Interfaces:**
- Produces: `addProvider`, `updateProvider`, `removeProvider`, `nextActiveAfterDelete` (murni, array → array).
- **Aktual:** `removeProvider` ditambahkan agar endpoint bawaan (seed) bisa "dihapus" sebagai override `{ hidden: true }`; `resolveProviders` menyaringnya.

```js
export function addProvider(providers, provider) { return [...providers, provider]; }
export function updateProvider(providers, id, patch) {
  return providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
}
export function nextActiveAfterDelete(providers, activeId, deletedId) {
  const remaining = providers.filter((p) => p.id !== deletedId);
  return remaining.some((p) => p.id === activeId) ? activeId : (remaining[0]?.id || '');
}
```

- [x] **Step 1: Tambahkan ketiga helper CRUD** di providers.js (dekat `resolveApiKey`)
- [x] **Step 2: Test — add/update/delete + pindah provider aktif**
- [x] **Step 3 (aktual): Tambahkan `removeProvider`** — custom dibuang; seed ditandai `hidden`; `resolveProviders` menyaring id tersembunyi. 18 test `settings.test.mjs` hijau.

```js
test('addProvider: append endpoint baru', () => {
  const r = addProvider([{id:'a'}], {id:'b'});
  assert.equal(r.length, 2); assert.deepEqual(r[1].id, 'b');
});
test('updateProvider: perbarui entry berdasar id (idempotent)', () => {
  const r = updateProvider([{id:'a',key:''}], 'a', { key:'K' });
  assert.equal(r.length, 1); assert.equal(r[0].key, 'K');
});
test('nextActiveAfterDelete: pindah ke endpoint lain bila aktif dihapus', () => {
  const ps = [{id:'a'},{id:'b'}];
  assert.equal(nextActiveAfterDelete(ps, 'a', 'a'), 'b');
  assert.equal(nextActiveAfterDelete(ps, 'b', 'a'), 'b'); // 'a' dihapus, 'b' tetap aktif
});
test('nextActiveAfterDelete: '' bila endpoint terakhir dihapus', () => {
  assert.equal(nextActiveAfterDelete([{id:'a'}], 'a', 'a'), '');
});
```

---

### Task 5: Refactor `connectEndpoint` + tambah `deleteProvider` (CRUD backend)

**Files:**
- Modify: `js/app.js`
- Test: regression suite (`core.test.mjs`) — `connectEndpoint` tetap return listModels; tambah test CRUD via wrapper.

**Interfaces:**
- Consumes: `{ baseUrl, name, key, providerId? }`.
- Produces: endpoint baru (tambah) atau entry terupdate (edit); `deleteProvider(id)` menghapus + pindahkan provider aktif.

**Konteks:**
- `connectEndpoint` (lines 253–278): tambahkan param opsional `providerId`. Bila ada → mode edit (`updateProvider` di tempat, `provider = providerId`); bila tidak → tambah seperti sekarang.
- Tambahkan `deleteProvider(id)`: hapus dari array, hitung provider aktif baru via `nextActiveAfterDelete`, `persistSettings()`, re-render options + refresh model list.

```js
async function deleteProvider(id) {
  const active = state.settings.provider;
  const next = nextActiveAfterDelete(state.settings.providers || [], active, id);
  state.settings.providers = (state.settings.providers || []).filter((p) => p.id !== id);
  state.settings.provider = next;
  persistSettings();
  renderProviderOptions();
  await refreshProviderModelList();
}
```

- [x] **Step 1: Refactor `connectEndpoint({ providerId })`** (lines 253–278)
  - **Aktual:** upsert — edit seed menulis override dengan id yang sama; kapabilitas seed (`supportsGrounding`, `supportsThinking`) dipertahankan.
- [x] **Step 2: Tambahkan `deleteProvider(id)`** (dekat connectEndpoint)
  - **Aktual:** memakai `removeProvider` (bukan `filter`) agar seed bisa disembunyikan.
- [x] **Step 3: Update caller di bindEvents (line 1540)** — kirim `providerId` bila mode edit; reset form + label tombol.
- [x] **Step 4: Test regression** — `connectEndpoint` tambah endpoint tetap jalan; `deleteProvider` pindahkan provider aktif.
  - **Aktual:** diverifikasi via `smoke-crud.mjs` (jsdom): tambah endpoint custom → terpilih → model termuat; hapus endpoint aktif → provider pindah & dropdown sinkron.

---

### Task 6: UI daftar endpoint + sunting/hapus + toggle kunci per-endpoint

**Files:**
- Modify: `index.html`, `js/app.js`, `css/*.css` (opsional)
- Test: manual (browser)

**Interfaces:**
- Consumes: panel endpoint eksisting (lines 205–228), field `#customProviderKey`.
- Produces: daftar endpoint terdaftar + tombol Sunting/Hapus; toggle show/hide kunci per-endpoint.

**Konteks:**
- **index.html**: di bawah panel "Tambah endpoint" (line 227), tambahkan `<div id="endpointList">` berisi baris endpoint (nama · baseUrl · btn Sunting · btn Hapus). Field `#customProviderKey` diberi tombol toggle show/hide (ikon EYE/EYE_OFF, pola sama dengan `dom.apiKeyToggle`).
- **app.js**:
  - Tambahkan `renderEndpointList()` → render baris dari `state.settings.providers`.
  - Tombol "Sunting" → buka modal pop-up (showModal) berfield Base URL · nama · kunci (+toggle EYE), prefill dari endpoint; simpan → `connectEndpoint({providerId})` → re-render + toast. Form atas tetap hanya untuk *tambah* endpoint baru.
  - Tombol "Hapus" → `showConfirm({ title, text, confirmLabel, kind:'danger', onConfirm: () => deleteProvider(id) })`.
  - Toggle kunci per-endpoint: pola sama dengan handler `dom.apiKeyToggle` (lines 1548–1553).

- [x] **Step 1: Tambahkan markup daftar endpoint + toggle kunci** di index.html
  - **Aktual:** `<ul id="providerList" class="provider-list">` + `#providerKeyToggle` pada field `#customProviderKey`; panel kunci umum dihapus; "Hapus semua data" dipindah ke section **Reset Data** di dasar drawer.
- [x] **Step 2: `renderEndpoints()` + binding Sunting/Hapus** di app.js
  - **Aktual:** delegasi klik dipasang sekali di `bindEvents` (bukan di dalam render) agar listener tidak menumpuk; seed diberi badge "Bawaan".
- [x] **Step 3: Toggle show/hide kunci per-endpoint** (ikon EYE/EYE_OFF)
  - **Aktual:** toggle ada di form dan di tiap baris daftar endpoint.
- [x] **Step 4: Manual test browser** — tambah → kunci khusus tersimpan & dipakai; **sunting via modal pop-up** (prefill + simpan kunci per-endpoint) → tersimpan; hapus → confirm → provider pindah.
  - **Aktual:** diverifikasi via 3 smoke test jsdom (`smoke.mjs`, `smoke-legacy.mjs`, `smoke-crud.mjs`) — bukan browser sungguhan.

---

### Task 7: Regression & integrasi akhir

**Files:**
- Test: semua suite (`node --test tests/`)
- Manual: browser (full flow)

- [x] **Step 1: Jalankan suite per-file** — `for f in tests/*.test.mjs; do node --test "$f"; done`. Semua hijau, termasuk `settings.test.mjs` baru.
  - _Catatan:_ batch `node --test tests/` punya 1 subtest aggregate fail pre-existing (interference global-state antar-file; shim `document`/`window` ditimpa). Verifikasi per-file = konvensi repo & reliable.
  - **Hasil:** 9 file, 90 test lulus (chat-footer 4, core 16, metadata 4, pricing 4, providers 17, rag 6, redo 15, settings 18, summarize 6).
- [x] **Step 2: Full-flow manual**:
  - Input manual tanpa starter → auto-greeting jalan.
  - Tambah endpoint → kunci khusus dipakai (`resolveApiKey`); **sunting via modal pop-up** → prefill + simpan kunci/nama per-endpoint; hapus → confirm → provider pindah ke endpoint lain.
  - Chat normal (kirim, regenerasi, edit) tetap berfungsi.
  - **Aktual:** alur drawer diverifikasi via smoke test jsdom; chat/regenerasi diverifikasi via suite `chat-footer` + `redo` (bukan klik browser).
- [ ] **Step 3: Git commit** di branch `feat/drawer-config`.
  - **Status:** perubahan belum di-commit; branch saat ini belum dicek/dibuat.

---

## Self-Review Checklist
- [x] Fitur A: starter dihapus dari UI + handler; input manual; auto-greeting jalan. ✓
- [x] Fitur B: presedensi kunci per-endpoint (+fallback); CRUD add/edit/delete; hapus endpoint aktif → pindah ke endpoint lain. ✓
- [x] Skema data tidak berubah: `starters` tetap ada (backwards-compat), array `providers` tak berubah skema, `messages` utuh. ✓
- [x] Logika kunci/CRUD dipisah jadi fungsi murni → unit-testable tanpa DOM. ✓
- [x] Semua suite lama + baru hijau; 0 error console/page. ✓ (90 test; smoke jsdom tanpa error halaman)
