# Design Doc — Refactor Provider: Tanpa Gemini Bawaan, Header Chat, Token ↑↓

Tanggal: 2026-11-02
Branch target: `feat/custom-provider` (dari `feat/enhancement` @ `822c82b`)

## 1. Konteks & Tujuan

Rilis sebelumnya menambahkan abstraction provider [OI]-compatible, tetapi masih menyisakan
**provider Gemini bawaan** (`PROVIDERS.gemini` dengan `x-goog-api-key`, `API.defaultModel` gemini,
harga gemini di tabel). User ingin:

1. **Tidak ada provider hardcode** — daftar model SELALU diambil dari endpoint provider itu sendiri
   (per-endpoint), sehingga tidak menimbulkan bug/model fantasi. Contoh endpoint:
   `http://127.0.0.1:1234` (LM Studio).
2. **Kunci API opsional** — endpoint lokal tidak butuh auth.
3. **Onboarding baru**: URL endpoint dulu → probe → pilih model → materi → chat.
4. **Selector provider/model di header chat** — bisa diganti kapan saja selagi chat, tanpa buka drawer.
5. **Token count per balasan** dalam bentuk `↑ 320 · ↓ 240 token` (masuk & keluar).
6. **Tanpa preset tombol endpoint** — URL diketik manual karena bisa berbeda-beda.

### Non-goals
- Tidak ada preset endpoint (LM Studio/Ollama/[OI] tombol cepat) — dihapus dari desain.
- Tidak ada backend; semua di localStorage (`tanyabukan.*`).
- Tidak ada streaming baru; tetap pakai alur `streamText` yang ada.

## 2. Keputusan Desain (dikonfirmasi user)

| Topik | Keputusan |
|---|---|
| Gemini bawaan | **Dihapus total** — `PROVIDERS` mulai kosong; nol jejak Google di kode aktif |
| Daftar model | Selalu dari endpoint (`GET {baseUrl}{modelsPath}`), filter chat-capable, dedup |
| Kunci API | Opsional; kosong → tanpa header auth; diisi → `Authorization: Bearer` (atau header kustom) |
| Onboarding | URL dulu → probe → model → materi |
| Posisi selector | **Header/topbar chat, permanen** (dropdown endpoint + dropdown model + indikator status) |
| Preset endpoint | Tidak ada |
| Token footer | `↑ {in} · ↓ {out} token`; biaya hanya bila model ada di tabel harga |
| Migrasi data lama | `provider:'gemini'` di localStorage dibersihkan → onboarding muncul lagi; riwayat chat aman |

## 3. Arsitektur

### 3.1 `js/providers.js`
- `export const PROVIDERS = {}` — registry bawaan kosong.
- `resolveProviders(custom)` tidak berubah (merge custom by id, flag `custom:true`).
- **`probeEndpoint(baseUrl, apiKey)` (baru, murni fetch):**
  1. Normalisasi URL (trim; hapus trailing `/`).
  2. Coba `GET {base}/models`; jika gagal (network/HTTP >= 400) coba `GET {base}/v1/models`.
  3. Return path yang hidup: `{ modelsPath: '/models' }` atau `{ modelsPath: '/v1/models' }`.
  4. Gagal keduanya → throw error ramah ("Endpoint tidak merespons /models maupun /v1/models").
  5. Header auth hanya jika `apiKey` non-kosong.
- `chatCompletion` tidak berubah bentuk; `authHeader(provider, apiKey)`:
  `apiKey` kosong → return `{}` (tanpa header auth). `authHeader === 'x-goog-api-key'`
  **dihapus** (tidak relevan lagi) — sisanya Bearer atau header kustom.
- `providerChat` tidak berubah.

### 3.2 Onboarding (`index.html`, `js/app.js`)
Alur baru:
1. Field **Base URL** (wajib) + field **Nama endpoint** (opsional, default = hostname URL)
   + **Kunci API** (opsional, toggle show/hide seperti sekarang).
2. Tombol **"Hubungkan"** → `probeEndpoint` → simpan endpoint ke `state.settings.providers`
   (id = slug nama/hostname; set aktif `provider = id`) → `listModels` (path hasil probe) →
   dropdown **Pilih model** terisi.
3. Pilih model → disimpan ke `state.settings.model` → lanjut isi materi → mulai chat.
4. Endpoint sudah terhubung + model terpilih = onboarding selesai (localStorage `provider` +
   `model` terisi; session berikutnya langsung chat).

### 3.3 Header chat (topbar)
- Di topbar, kiri/kanan sesuai layout ada:
  - `<select id="headerEndpointSelect">` — daftar endpoint terdaftar (label = nama).
  - `<select id="headerModelSelect">` — model dari endpoint aktif (refresh saat endpoint berubah).
  - Indikator status `<span id="headerConnStatus">` — `●` hijau "terhubung" / merah "gagal" /
    abu "belum ada endpoint".
- Perubahan endpoint di header → `refreshProviderModelList()` (sudah generik dari Task 7)
  → dropdown model menyesuaikan.
- CRUD endpoint tetap di drawer Pengaturan (tambah/edit/hapus URL, nama, kunci) — tanpa preset.

### 3.4 Bersih-bersih jejak Gemini
- `js/api.js`: hapus `callGemini` + `fetchAvailableModels` (sudah tidak dipakai; periksa
  dependensi `API.baseUrl`/`API.defaultModel` yang gemini-spesifik di `js/config.js`).
- `js/config.js`: hapus `API.defaultModel` (atau ganti `''` — model harus dipilih dari endpoint).
- `js/pricing.js`: hapus entri harga model gemini (biarkan tabel untuk model lain; model lokal
  → tanpa biaya, graceful).
- `js/app.js`: `DEFAULT_SETTINGS.model = ''`, `DEFAULT_SETTINGS.provider = ''`; hapus sisa
  referensi gemini; kunci onboarding jadi opsional di validasi (`sendUserMessage` dll:
  ganti guard "kunci wajib" → guard "endpoint + model terpilih").

### 3.5 Footer token ↑↓ (`js/chat.js`)
- `addCostFooter(col, tokens, cost)` → format:
  - Ada `tokens.prompt` & `tokens.completion` → `↑ 320 · ↓ 240 token`.
  - Hanya completion → `↓ 240 token`.
  - `cost` number → tambah ` · ~$X.XX`.
  - Semua kosong → tidak render (null), seperti sekarang.
- `sessionStats()` statistik tetap: total biaya (bila diketahui); token total tetap dari
  metadata — tidak ada perubahan skema `messages` (tokens `{prompt,completion,total}` sudah ada).

### 3.6 Migrasi data lama
- Saat init: baca settings; jika `settings.provider === 'gemini'` ATAU `settings.model`
  memuat prefix `gemini-` → reset `provider = ''`, `model = ''` (onboarding muncul lagi).
  Riwayat sesi & metadata pesan TIDAK disentuh.

## 4. Error & Edge Cases
- Endpoint gagal probe → toast + pesan inline di onboarding; tidak menyimpan endpoint.
- Header ganti endpoint yang model list-nya gagal diambil → dropdown model kosong + pesan
  "Gagal mengambil model dari endpoint" (status merah); pilihan endpoint tetap tersimpan.
- Kirim tanpa endpoint/model → toast "Pilih endpoint & model dulu" + fokus ke header select.
- Endpoint lokal dengan kunci kosong → request tanpa header auth (tidak error CORS/CORS-preflight
  tambahan).

## 5. Pengujian
- **Otomatis (`node --test`):**
  - `tests/providers.test.mjs`: resolveProviders() kosong → `{}`; probeEndpoint pilih
    `/models` vs `/v1/models` (fake fetch); authHeader kosong → `{}`; chatCompletion tetap
    parse `usage.tokens` (sudah ada).
  - `tests/pricing.test.mjs`: gemini tak lagi di tabel; findPrice model tak dikenal → null.
  - `tests/chat-footer.test.mjs` (baru): format footer `↑ 320 · ↓ 240 token`, biaya
    bersyarat, null bila kosong.
  - `tests/migration.test.mjs` (baru): settings `provider:'gemini'` di-reset; model
    `gemini-*` dibersihkan; settings baru utuh.
  - Regression: semua suite lama tetap hijau (core/metadata/redo/providers/pricing).
- **Manual (browser bila tersedia):** onboarding URL `http://127.0.0.1:1234` (LM Studio) →
  model terambil → chat → footer `↑ ↓`; ganti endpoint di header; tanpa kunci → request
  tanpa auth header (devtools network).

## 6. File yang Berubah
- `js/providers.js` — registry kosong, probeEndpoint, authHeader opsional.
- `js/config.js` — hapus gemini default model / baseUrl gemini.
- `js/api.js` — hapus callGemini + fetchAvailableModels (+ helper gemini-only yang mati).
- `js/app.js` — onboarding baru, header selector, guard opsional-kunci, migrasi settings.
- `index.html` — form onboarding baru, header endpoint/model select, hapus field wajib-kunci.
- `js/chat.js` — footer `↑ · ↓ token`.
- `css/*.css` — styling header selector + footer token.
- `js/pricing.js` — hapus entri gemini.
- `tests/*` — baru + penyesuaian.

## 7. Self-Review (ringkas)
- Setiap tujuan §1 punya desain: 1→§3.1/§3.4, 2→§3.1/§3.2, 3→§3.2, 4→§3.3, 5→§3.5, 6→§3.2/§3.3. ✓
- Tidak ada preset endpoint. ✓ Tidak ada model hardcode — semua dari endpoint. ✓
- Skema data pesan tidak berubah → riwayat lama tetap terbaca. ✓
- Scope satu plan implementasi; tidak butuh dekomposisi. ✓
