# Design Doc — Enhancement TanyaBukan

**Tanggal:** 2026-11-01
**Status:** Disetujui · menunggu implementation plan
**Sasaran:** Tutor Socratic berbasis materi (HTML/CSS/JS statis, Gemini API BYOK)

---

## 1. Konteks & Tujuan

TanyaBukan sudah fitur-lengkap untuk sasaran (sisu SMA): BYOK + RAG, 4 mode belajar, slider kedalaman, **cari web (grounding)**, multi-turn + LaTeX + kutipan `[[...]]`, riwayat sesi, ekspor, responsif. Tiga tambahan berikut membuatnya terasa *lengkap seperti ChatGPT/DeepNorm/Claude*:

1. **Tools chat** — regenerasi balasan (*redo*) & sunting pesan → ulang ke belakang (*edit*).
2. **Provider unified (OpenAI-compatible)** — tidak terikat Gemini; daftar model otomatis menyesuaikan endpoint + API-key.
3. **Indikator biaya + token** — transparansi penggunaan (token keluar selalu, biaya estimasi bila harga diketahui).

### Goals
- Redo & edit bekerja mulat di atas riwayat yang sudah tersimpan per sesi.
- Satu abstraksi provider: Gemini tetap default, endpoint custom (Groq/DeepSeek/Ollama/LM Studio) bisa ditambah. Daftar model **dari** `/models` endpoint, bukan hardcoded.
- Token keluar tampil di setiap balasan; biaya estimasi muncul hanya bila harga model diketahui.

### Non-goals
- Tidak membangun backend / penyimpanan token ke server.
- Tidak mengubah filosofi Socratic (tetap bimbing, bukan jawab).
- Tidak mendukung streaming token-per-kata baru (pakai streamText yang sudah ada).

---

## 2. Keputusan Desain (validated)

| # | Keputusan | Pilihan | Hasil |
|---|-----------|---------|-------|
| A | Model provider | diseragamkan / dual | **Diseragamkan** → 1 abstraksi OpenAI-compatible; list model dari endpoint |
| A-⚠️ | Grounding & thinkingLevel (khusus Gemini) | wajib / per-provider | **Opsi per-provider** — aktif bila endpoint mendukung, otomatis mati + *graceful degradation* bila tidak |
| B | Ruang lingkup tools | redo / edit / keduanya | **a + b** → regenerasi balasan **+** edit pesan → ulang ke belakang |
| C | Sumber harga | hardcode / manual / keduanya | **Hardcode tabel harga** (model populer), editable |
| D | Skopus build | semua / prioritas | **Semua, diprioritaskan** per fasa (lihat §7) |

> ⚠️ **Trade-off grounding/thinking (poin A-⚠️):** format OpenAI umum tidak punya padanan *built-in* untuk Google Search grounding & `thinkingLevel`. Karena OpenAI-compatible menjangkau banyak provider, keduanya disimpan sebagai **opsi per-provider**: Gemini mengaktifkannya, endpoint lain mengabaikannya. Bila endpoint menolak field `tools`/custom, sistem mencoba ulang tanpa field tersebut (*graceful degradation*), bukan error.

---

## 3. Arsitektur: Modul `js/providers.js`

Menggantikan panggilan Gemini-specific di `api.js`. Satu antarmuka untuk semua provider.

### 3.1 Config provider
```js
export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Gemini (default)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsPath: '/openai/models',          // adapter OpenAI Gemini
    chatPath:   '/openai/chat/completions',
    authHeader: 'x-goog-api-key',          // atau 'Bearer' (konfigurabel)
    supportsGrounding: true,
    supportsThinking: true,
  },
  // provider custom user disimpan di settings (array), struktur sama,
  // id unik + field 'custom': true
};
```

### 3.2 `listModels(apiKey, provider)`
- `GET ${baseUrl}${modelsPath}` dengan header auth provider.
- Response OpenAI: `{ data: [ { id, object, owned_by, capabilities? } ] }`.
- Filter model *chat-capable*: ikut bila tidak eksplisit embedding-only (fleksibel antar-provider).
- Return array `id` → dropdown model **otomatis menyesuaikan endpoint**.

### 3.3 `chatCompletion({ provider, apiKey, model, systemPrompt, contents, maxTokens, thinkingLevel, grounding })`
- Konversi `contents` (`{role:'user'|'model', text}`) → OpenAI `messages`:
  - `systemPrompt` → `{ role:'system', content }`
  - `user` → `{ role:'user', content }`
  - `model` → `{ role:'assistant', content }`
- POST `${baseUrl}${chatPath}` body: `{ model, messages, max_tokens, tools? (grounding), thinkingConfig? }`.
- Parse response: `choices[0].message.content` + `usage.{prompt,completion,total}_tokens`.
- Return `{ text, tokens: { prompt, completion, total }, sources? }`, atau lempar `{ type, message }` via `mapApiError`.

### 3.4 Pemetaan error
- Terapkan `mapApiError` yang sudah ada (auth/quota/network/model/server/badrequest/truncated/empty) untuk semua provider.

---

## 4. Fitur B — Tools Chat (Redo + Edit)

### 4.1 Regenerasi balasan (*redo*)
- Tombol di bubble tutor → panggil `chatCompletion` dengan **riwayat utuh sampai pesan user terakhir**, ganti isi bubble model terakhir.
- Metadata token/harga balasan lama diganti yang baru.

### 4.2 Sunting pesan → ulang ke belakang (*edit*)
- Tombol edit di pesan user → sunting inline (textarea) → rebuild `contents` **sampai & termasuk** pesan yang disunting → regenerasi **semua balasan model setelahnya** (urutan: hapus bubble lama → render ulang satu per satu).
- Tetap pertahankan file materi sesi + mode/level.

### 4.3 Perubahan data model
Struktur pesan (`session.messages`) ditambah field opsional:
```js
{ role, text, label?, hidden?, kind?,            // sudah ada
  model?, tokens?: { prompt, completion, total }, // baru
  cost?: number, sources?: [...] }                // baru
```
- `syncSession` / `createSession` tetap kompatibel (field opsional).
- Tersimpan di localStorage → survive redo/edit/refresh.

---

## 5. Fitur C — Indikator Biaya + Token

### 5.1 Tabel harga hardcoded (`js/pricing.js`)
Keyed by model id → harga per 1M token (USD), contoh set awal:

| Model | Input / Output ($/1M) |
|-------|------------------------|
| gemini-3.8-flash | 0.50 / 4.00 |
| gemini-3.6-flash | 0.30 / 2.50 |
| gemini-3.5-flash-lite | 0.10 / 0.40 |
| gpt-4o-mini | 0.15 / 0.60 |
| gpt-4o | 2.50 / 10.00 |
| deepseek-v3 | 0.27 / 1.10 |
| deepseek-r1 | 0.55 / 2.19 |
| qwen-* | 0.00 / 0.00 (gratis) |
| groq-* (free tier) | 0.00 / 0.00 |

> Harga *indikatif*, bisa diedit di tabel. Biaya = `completionTokens × outputPerM / 1e6` (+ opsional input). Fokus pada **token keluar** sesuai permintaan.

### 5.2 Tampilan
- Footer bubble tutor: `· 240 token · ~Rp <biaya>` (konversi USD→Rp sederhana, atau tampilkan $ bila mau).
- Muncul hanya bila harga model diketahui; model unknown → tampilkan token saja.
- Ringkasan total (token + biaya estimasi sesi) di area statistik/dekat tombol Ekspor.

---

## 6. Perubahan UI

- **Bubble tutor:** footer token/biaya + tombol *regenerasi* (ikon putar-balik).
- **Bubble user:** tombol *edit* (pensil) → sunting inline → regenerasi ke belakang.
- **Drawer Pengaturan:** section **Provider** — dropdown provider + "Tambah endpoint custom" (`baseUrl`, opsional `authHeader`). Daftar model refresh otomatis saat ganti provider/kunci.
- **Statistik:** total token + biaya estimasi sesi (dekat timer/Ekspor).
- Gaya mengikuti design system yang ada (`.btn--ghost.btn--sm`, `.msg__footer`).

---

## 7. Fasa Build (prioritas)

| Fasa | Fitur | Ketergantungan | Catatan |
|------|-------|----------------|---------|
| **P1** | Tools chat (redo + edit) | — | Bangun di atas path Gemini sekarang; tambah field metadata pesan + pure function (`regenerateLast`, `regenerateFrom`) + UI. Risiko rendah. |
| **P2** | Provider unified (OpenAI-compatible) | — | `providers.js`, refactor `callGemini` → `provider.chat()`, `listModels` dari endpoint, section provider di drawer. Grounding/thinking = ops per-provider + graceful degradation. Bawa tangkap `usage`. |
| **P3** | Indikator biaya/token | P2 (tangkap token) | `pricing.js` + tampilkan footer/statistik. Bisa "menumpang" tangkap token dari P1/P2. |

> Catatan: P1 bisa menyimpan field `tokens` (dari Gemini `usageMetadata`) sehingga P3 tinggal menambahkan harga di atasnya.

---

## 8. Pengujian

### Otomatis (`node --test`, lanjutkan `tests/core.test.mjs` / tambah `tests/providers.test.mjs`)
- `listModels`: filter chat-capable, header auth, fallback error ramah.
- `chatCompletion`: konversi messages, parse content + usage, mapping error.
- `pricing`: kalkulasi biaya per model (known/unknown).
- Redo/edit: pure function (`regenerateLast`, `regenerateFrom`) — input array pesan → output array baru.
- `syncSession`/`createSession`: kompatibel dengan field metadata opsional.

### Manual (Playwright)
- Tombol redo/edit berfungsi, balasan regenerasi benar.
- Ganti provider → dropdown model menyesuaikan.
- Footer token/biaya tampil sesuai harga model.
- Regression: 20 test lama tetap lolos; 0 error console.

---

## 9. File yang Berubah

| File | Aksi |
|------|------|
| `js/providers.js` | **Baru** — abstraksi provider + list/chat |
| `js/pricing.js` | **Baru** — tabel harga + kalkulasi |
| `js/api.js` | Modifikasi → delegasi ke `providers.js` (pertahankan `mapApiError`, `extractSources`) |
| `js/config.js` | Modifikasi — config provider + storage key |
| `js/sessions.js` | Modifikasi — metadata pesan di `createSession`/`syncSession` |
| `js/chat.js` | Modifikasi — footer token/biaya + tombol redo/edit |
| `js/ui.js` / `app.js` | Modifikasi — section provider di drawer, wiring |
| `css/components.css` | Modifikasi — gaya footer + tombol baru |
| `tests/*.test.mjs` | Modifikasi/Tambah — coverage fitur baru |

---

## 10. Self-Review (ringkas)
- **Placeholder:** tidak ada TBD; harga *indikatif* sudah ditandai editable.
- **Konsistensi:** abstraksi provider ↔ dropdown dari endpoint ↔ footer biaya konsisten secara data flow.
- **Scope:** 3 fitur kohesif, 1 spec, fasa jelas — cukup untuk 1 implementation plan.
- **Ambiguitas terpecah:** grounding = ops per-provider + graceful degradation; biaya = token keluar selalu, harga bila diketahui; edit = regenerasi ke belakang.
