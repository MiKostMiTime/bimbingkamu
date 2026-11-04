# Design Doc — Pengaturan Drawer: Hapus Prompt Starter + Kunci Per-Endpoint & CRUD

Tanggal: 2026-11-04
Branch target: `feat/drawer-config` (dari `feat/custom-provider`)

## 1. Konteks & Tujuan

Drawer **Pengaturan** saat ini menyimpan dua hal yang sudah mapan: kunci API, endpoint/model,
mode/tone/level, prompt starter, dan hapus semua data. Dua perbaikan diminta user untuk membuat
pengaturan lebih ringkas dan presisi per-akun endpoint:

1. **Fitur A — Hapus prompt starter.** Chip *starter* (`uji` / `jelaskanin` / `ringkasan` /
   `latihan` / `lainnya`) dihapus dari UI karena jarang dipakai; pengguna mengetik manual.
   Auto-greeting (panduan mode/tone/level + materi) tetap jalan.
2. **Fitur B — Kunci per-endpoint & CRUD endpoint.** Setiap endpoint bisa punya **kunci API
   sendiri** (bukan hanya satu kunci umum `state.apiKey`); dan endpoint yang sudah terhubung
   bisa **disunting** atau **dihapus** di drawer, bukan hanya ditambahkan.

### Non-goals
- Tidak menambah preset endpoint (tetap diketik manual).
- Tidak mengubah skema `messages`; tidak menambah field baru di sesi/riwayat.
- `starters` tetap disimpan di settings (backwards-compat) — hanya *highlight* chip yang dihapus.
- Hapus semua data (`resetAll`) tetap ada sebagai aksi terpisah; CRUD endpoint adalah per-endpoint.

## 2. Desain Konfirmasi User

| Topik | Keputusan |
|---|---|
| Prompt starter | **Dihapus** dari `index.html` + handler `bindEvents` + map `STARTER_TEXT`. Input diketik manual. |
| Highlight starter | Dihapus dari `hydrateSettings()` (state `starters` tetap hidrat, tak dipakai). |
| Auto-greeting | Tetap jalan lewat `buildGreetingMessage()` (materi + mode/tone/level). |
| Kunci API | **Per-endpoint** (field sendiri tiap endpoint) + **fallback** kunci umum `state.apiKey`. |
| Presedensi kunci | `(currentProviders()[provider]?.key) || state.apiKey || ''` — kunci endpoint menang. |
| CRUD endpoint | Tambah (sudah ada) **+ Sunting + Hapus** per baris di drawer. Hapus → `showConfirm`. |
| Hapus endpoint aktif | `provider` pindah ke endpoint lain (atau `''` bila terakhir); model list disegarkan. |
| Edit endpoint | Isi form + simpan id; ubah label tombol "Hubungkan" → "Simpan perubahan". |

## 3. Arsitektur

### 3.1 Presedensi kunci — `resolveApiKey` (murni, di-ekspor)
Fungsi murni untuk menguji presedensi tanpa DOM:

```js
export function resolveApiKey(providers, activeId, legacyKey) {
  const p = providers[activeId];
  return (p && p.key) || legacyKey || '';
}
function activeApiKey() {
  return resolveApiKey(currentProviders(), state.settings.provider, state.apiKey);
}
```

`currentProviders()` = `resolveProviders(state.settings.providers)` (objek key-by-id). Helper ini
murni: menerima array/objek + id + fallback → mengembalikan string.

### 3.2 CRUD endpoint — helper murni pada array providers
Operasi pada `state.settings.providers` (array) dikemas jadi fungsi murni agar unit-testable;
wrapper tipis di `app.js` yang mengurus `persistSettings()` + re-render:

```js
export function addProvider(providers, provider) {
  return [...providers, provider];
}
export function updateProvider(providers, id, patch) {
  return providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
}
export function nextActiveAfterDelete(providers, activeId, deletedId) {
  const remaining = providers.filter((p) => p.id !== deletedId);
  return remaining.some((p) => p.id === activeId) ? activeId : (remaining[0]?.id || '');
}
```

`connectEndpoint()` di-refactor agar menerima `{ providerId }`:
- **Tambah** (`providerId` undefined): append endpoint baru, set `provider = id`, seperti sekarang.
- **Edit** (`providerId` terisi): `updateProvider` di tempat (nama/URL/kunci/modelsPath/chatPath),
  `provider` tetap ke id itu.

### 3.3 UI daftar endpoint + sunting/hapus
Di drawer, tepat di bawah panel "Hubungkan Endpoint", tampilkan daftar endpoint terdaftar:
- Setiap baris: **nama** · baseUrl · tombol **"Sunting"** + **"Hapus"**.
- **"Sunting"** → buka **modal pop-up** (`showModal` berfield Base URL · nama · kunci + toggle EYE) yang **prefill** data endpoint, lalu simpan lewat `connectEndpoint({providerId})`. Form atas (panel "Hubungkan Endpoint") tetap hanya untuk *tambah* endpoint baru.
- **"Hapus"** → `showConfirm({ title, text, confirmLabel, kind: 'danger', onConfirm })` →
  `deleteProvider(id)` → `nextActiveAfterDelete` + refresh model list.
- Field kunci per-endpoint (`#customProviderKey`) diberi **toggle show/hide** (pakai ikon
  `EYE`/`EYE_OFF` yang sudah ada) agar setara dengan field kunci umum.

### 3.4 Hapus prompt starter (Fitur A)
- `index.html`: hapus blok chip starter (`#starterSegment .segmented__btn` + label).
- `js/app.js`: hapus map `STARTER_TEXT`; hapus handler `dom.starters.forEach(...)` di `bindEvents`;
  hapus blok highlight starter di `hydrateSettings()`.
- `state.settings.starters` tetap ada & terhidrat (tidak dipaksa reset) — backwards-compat bila
  settings lama tersimpan.

## 4. Error & Edge Cases
- **Hapus endpoint aktif** → `provider` pindah ke endpoint lain; bila tidak ada lagi → `''`
  (onboarding muncul kembali di sesi berikutnya). Riwayat sesi & metadata pesan aman.
- **Edit tanpa perubahan** → simpan kembali (idempotent); model list disegarkan.
- **Kunci per-endpoint kosong + fallback umum kosong** → request tanpa header auth (endpoint lokal).
- **Endpoint dipisah saat sesi aktif** → hanya provider yang hilang; chat lanjut ke endpoint baru
  setelah dipilih ulang.

## 5. Pengujian
- **Otomatis (`node --test`, `.mjs`):**
  - `tests/settings.test.mjs` (baru): shim DOM + localStorage minimal (pola `chat-footer.test.mjs`)
    → import `app.js`; uji:
    - `resolveApiKey`: kunci endpoint > fallback umum > ''.
    - `addProvider` / `updateProvider` / `nextActiveAfterDelete` pada array providers.
    - `activeApiKey()` mematuhi presedensi setelah mutate `state.settings.providers/provider`.
    - `hydrateSettings()` jalan tanpa field `starters` (Fitur A) — tidak throw, providerSelect terisi.
- **Regression:** semua suite lama tetap hijau (`core`, `metadata`, `redo`, `providers`, `pricing`,
  `chat-footer`).
- **Manual (browser):** tambah endpoint → kunci khusus tersimpan & dipakai; sunting nama/kunci →
  tersimpan; hapus endpoint → confirm → provider pindah; input manual tanpa starter → greeting jalan.

## 6. File yang Berubah
- `index.html` — hapus chip prompt starter (Fitur A); tambahkan daftar endpoint + tombol Sunting/Hapus (Fitur B).
- `js/app.js` — hapus `STARTER_TEXT` + handler starter; ekspor `resolveApiKey`, `addProvider`,
  `updateProvider`, `nextActiveAfterDelete`; refactor `connectEndpoint({ providerId })`; tambah
  `deleteProvider`; hapus highlight starter di `hydrateSettings`.
- `css/*.css` — styling daftar endpoint (opsional, mengikuti `.panel`/`.btn--sm` yang ada).
- `tests/settings.test.mjs` (baru) + penyesuaian regression.

## 7. Self-Review (ringkas)
- Fitur A: starter dihapus dari UI + handler; input manual; auto-greeting tetap jalan. ✓
- Fitur B: presedensi kunci per-endpoint (+fallback); CRUD lengkap add/edit/delete; hapus endpoint
  aktif → pindah ke endpoint lain. ✓
- Skema data tidak berubah: `starters` tetap ada (backwards-compat), array `providers` tak berubah
  skema, `messages` utuh. ✓
- Logika kunci/CRUD dipisah jadi fungsi murni → unit-testable tanpa DOM. ✓
