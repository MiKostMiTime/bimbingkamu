# Task 10 Report — Regression & Integrasi Akhir (Tutup F3: tangkap token dari kirim pertama)

**Branch:** `feat/enhancement` · **Base HEAD:** `f8625d1` (Task 9) · **Status:** ✅ DONE

---

## 1. Ringkasan
Menutup loose-end **F3**: sebelumnya footer bubble model hanya menampilkan biaya (`~$X.XX`) sampai redo/edit menyimpan `tokens`. Sekarang setiap balasan model menyimpan `tokens: {prompt,completion,total}` ke metadata pesan sejak **kirim pertama**, karena seluruh alur kirim/redo/edit dimigrasi dari `callGemini` (api.js) ke path unified OpenAI-generic `providerChat` (providers.js). Footer (`addCostFooter`, Task 9) otomatis menampilkan `· N token · ~<biaya>`.

## 2. File + Perubahan Kunci
- **`js/app.js`** — modifikasi utama: import + 4 site migrasi + export test-hook.
- **`tmp/task10-token-harness.mjs`** (baru) — mock-fetch harness untuk bukti integrasi F3.
- `js/api.js`, `js/providers.js` — **TIDAK diubah** (`callGemini` tetap diekspor; `providerChat`/`chatCompletion` sudah benar di Task 6).

## 3. Empat Site yang Dimigrasi (callGemini → providerChat)
Verifikasi langsung ke sumber (bukan asumsi nomor baris). Semua memetakan `webSearch` → `grounding`, menambah `customProviders: state.settings.providers || []`, dan menangkap `tokens` (+`sources`) ke model message. Footer + `updateStats()` sudah memanggil `.tokens` (Task 9), jadi cukup metadata terisi.

| # | Fungsi | Baris | Tangkap tokens ke | Catatan |
|---|--------|-------|-------------------|---------|
| 1 | `generateGreeting()` | ~511 | `modelMsg = { role:'model', text: replyText, tokens, sources }` (push) | `grounding: false`; sapaan = kirim pertama |
| 2 | `sendUserMessage()` | ~606 | `modelMsg = { role:'model', text: reply, sources, tokens }` (push) | `grounding: state.settings.webSearch` |
| 3 | `regenerateLast()` | ~706 | `state.messages[plan.modelIndex] = { ...prev, text: reply, sources, tokens }` | body redo |
| 4 | `regenerateFrom()` | ~779 | loop: `state.messages[reg.modelIndex] = { ...prev, text: reply, sources, tokens }` | edit-regen per iterasi |

Detail per-site (before→after) tersimpan di `task-10-review.diff`. Poin kunci:
- `buildSystemPrompt({... webSearch: <x> })` **tetap** — itu param buildSystemPrompt, bukan chatCompletion; tidak diubah.
- Param `webSearch` (asmi callGemini) → renamed jadi `grounding` (diterima chatCompletion).
- `thinkingLevel`, `contents`, `systemPrompt`, `apiKey`, `model` tetap.

## 4. Perubahan Import
- **Baris 8:** `import { callGemini } from './api.js';` → dikomentarkan (`// import ... // DIPINDAHKAN → providerChat dari providers.js`). Semua site sudah migrasi, jadi 0 dead-import.
- **Baris 9:** `import { resolveProviders, listModels } from './providers.js';` → tambah `providerChat`: `import { resolveProviders, listModels, providerChat } from './providers.js';`
- **Fungsi `callGemini` TINGGAL di `api.js`** (line 94: `export async function callGemini(...)`) — tidak dihapus, tetap diekspor, bisa dipakai ulang.
- **Test-hook baru** (akhir app.js, non-breaking): `export { generateGreeting, sendUserMessage, state };` agar harness Node bisa memanggil alur kirim + seed state langsung.

## 5. Mock-Fetch Harness (`tmp/task10-token-harness.mjs`)
Membukti F3 tertutup lewat **jalas kode asli app.js** (bukan mock unit):
1. **Shim DOM + localStorage + `window`/`requestAnimationFrame`** lengkap (El class: appendChild/insertBefore/innerHTML-parser `<option>`/append/etc.) sehingga `app.js` bisa di-muat & `init()` jalan di Node tanpa browser.
2. **Mock `global.fetch`** → response gaya chatCompletion: `{ choices:[{message:{content}}], usage:{ prompt_tokens:120, completion_tokens:240, total_tokens:360 } }`. Record setiap panggilan (url + init).
3. Muat `app.js`, seed `state.apiKey` + `state.settings = { provider:'gemini', providers:[], model:'gemini-3.8-flash', webSearch:false, ... }`.
4. Jalankan `generateGreeting()` **dan** `sendUserMessage()`, lalu flush timer.

### Asersi + Hasil (SEMUA PASS)
| Asersi | Result |
|--------|--------|
| model message `tokens.completion === 240` (greeting) | ✅ `{"prompt":120,"completion":240,"total":360}` |
| model message `tokens.completion === 240` (send) | ✅ sama |
| `.msg__footer` memuat `"240 token"` **DAN** `"~$"` (bukan cost-only) | ✅ text = **`"240 token · ~$0.00"`** |
| fetch ke endpoint OpenAI-shape `${baseUrl}${chatPath}` | ✅ `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` |
| header auth bawa kunci | ✅ `x-goog-api-key: TESTKEY-HARNESS` |
| body `{ model, messages, max_tokens }` (+ generationConfig) | ✅ |
| **BUKAN** Gemini-native `/generateContent` | ✅ 0 panggilan ke `/generateContent` |

Kost footer `~$0.00` = `estimateCost('gemini-3.8-flash',{completion:240})` = 240×$4/1M = 0.00096 → `formatCost` → `$0.00`. Token (`240 token`) + biaya (`~$0.00`) tampil bersamaan → **F3 tertutup**.
Log + screenshot tersimpan di `/tmp/tanyabukan-task10/harness-log.md` & `harness-footer-screenshot.txt`.

## 6. Regression (Step 6)
Command: `node --test tests/core.test.mjs tests/metadata.test.mjs tests/redo.test.mjs tests/providers.test.mjs tests/pricing.test.mjs`

| Suite | Pass / Total | Fail |
|-------|--------------|------|
| core    | 20 / 20 | 0 |
| metadata| 4 / 4   | 0 |
| redo    | 15 / 15 | 0 |
| providers| 8 / 8  | 0 |
| pricing | 4 / 4   | 0 |
| **TOTAL** | **51 / 51** | **0** ✅ (≥51) |

`node --check js/app.js` → **SYNTAX OK**.

## 7. Live E2E (Bonus — catatan keterbatasan)
- **Ketersediaan:** python3 ✓, network reachable (GET ke endpoint real → HTTP 404 = online), `index.html` serve ✓, port 5500 sudah aktif (sesuai brief). **Playwright lokal: tidak terpasang**, tidak ada cache browser, dan **tidak ada API key model** untuk panggilan real.
- **Yang dilakukan:** start `python3 -m http.server 5500`; verifikasi `index.html` (`<title>TanyaBukan — Tutor Socratic</title>`) + `app.js` & `providers.js` serve (HTTP 200). `curl js/app.js` mengonfirmasi **versi ter-migrasi** di-deploy: `providerChat` di baris 511/606/706/779, `callGemini` hanya di import-comment.
- **Keterbatasan:** e2e browser penuh (onboarding→send→footer token+biaya + 0 console error) **tidak dijalankan** karena tanpa Playwright/browser + tanpa API key (panggilan model real akan gagal/auth). Bukti integrasi F3 sudah **terpenuhi via mock-harness yang menjalankan kode app.js asli**. Direkomendasikan: jalankan `npx playwright install` + masukkan API key untuk e2e browser lengkap di environment berikutnya.

## 8. Self-Review vs Spec (§1–§10)
- **§1 Konteks & Tujuan** → konteks plan (all tasks). ✓
- **§2 Keputusan Desain** / **§3 Arsitektur providers.js** (`listModels`, `chatCompletion`, error mapping) → Task 6. ✓
- **§4 Fitur B (redo+edit)** — §4.1 redo panggil `chatCompletion` + ganti metadata token/harga; §4.2 edit regenerasi ke belakang; §4.3 data model `{ tokens?, cost?, sources? }` → Tasks 7/9/10. ✓
- **§5 Fitur C (indikator)** — §5.1 tabel harga `pricing.js`; §5.2 footer `· N token · ~biaya` muncul bila harga diketahui; total sesi → Tasks 8/9. ✓
- **§6 Perubahan UI** / **§7 Fasa Build** P1/P2/P3 → tasks terkait. ✓
- **§8 Pengujian** — otomatis (5 suite, 51 test) + manual Playwright (dicatat). ✓
- **§9 File yang Berubah** — `app.js` dimodifikasi (wiring). ✓
- **§10 Self-Review** — scan placeholder: **tidak ada TBD/TODO aktif** (hanya sebutan di instruksi self-review & catatan "tidak ada TBD" pada spec). ✓
- **Konsistensi nama fungsi:** `planRedo`(6), `planEdit`(2), `chatCompletion`(3), `providerChat`(12), `listModels`(4), `estimateCost`(4) — semua ada & konsisten. ✓
- **Footer di semua bubble model:** 5 site `addCostFooter(...)` (restore ~419, greeting ~531, send ~628, redo-rerender ~688, edit-regen-loop ~753) — semuanya lewat `.tokens`. ✓
- **#costTotal update + pakai token baru:** `sessionStats()` jumlahkan `m.tokens?.completion` + `computeCost(m)` (= `estimateCost(model, m.tokens)`); `updateStats()` set `dom.costTotal.textContent = formatCost(stats.cost)`. ✓
- **Gap fixed inline:** (a) komentur stale `callGemini` di baris 510/691/759 → ubah ke `providerChat`; (b) typo "buan"→"buan" di baris 510; (c) tambah export test-hook agar harness bisa memanggil alur asli.

## 9. File Berubah
| File | Aksi |
|------|------|
| `js/app.js` | Modifikasi (import + 4 site + export test-hook) |
| `tmp/task10-token-harness.mjs` | Baru (mock-fetch harness F3) |
| `.superpowers/sdd/.../task-10-report.md` | Baru (report ini) |
| `.superpowers/sdd/.../task-10-review.diff` | Baru (diff before→after per-site) |

## 10. Isyu / Catatan
- **Non-blocking:** e2e browser penuh belum dijalankan (keterbatasan Playwright + API key, catat di §7). Integrasi F3 sudah dibuktikan via harness yang jalankan kode app.js asli.
- Export test-hook (`generateGreeting`, `sendUserMessage`, `state`) ditambahkan di akhir app.js sebagai **tambahan non-breaking** — tidak mengubah perilaku di browser; hanya ekspos alur untuk uji Node.
- `callGemini` tetap diekspor dari api.js (sesuai instruksi: jangan dihapus).
