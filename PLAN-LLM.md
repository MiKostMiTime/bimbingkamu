# Rencana Perubahan Sistem LLM — BimbingKamu

Prioritas: **stabilitas & kualitas belajar > jumlah model**. Modular, aman, hemat biaya, multi-provider.
Metodologi: audit → rencana → implementasi bertahap (+ test + build tiap fase) → laporan. Kompatibilitas konfigurasi lama dipertahankan.

## Prinsip
- Pertahankan `providers.js` (mesin [OI]-generic yang sudah teruji 75 test) — **jangan di-rewrite**. Adapter baru ditambahkan sebagai *lapisan overlay*.
- Setiap provider = adapter tersendiri: endpoint, auth, model discovery, streaming, error, normalisasi.
- Backend Vercel (`api/proxy`) & `app.bundle.js` tetap jadi target build.
- Tidak pernah mengekspos API key; tidak mencatat credential/prompt di log.

## Fase 1 — Adapter Provider (✅ SELESAI)
Buat `js/adapters.js` sebagai sumber kebenaran adapter. Tambahkan:
- **ElectronHub** (HTTPS, [OI]-compatible, `/v1`, JANGAN pakai `/api/v0/models`).
- **Groq** (`https://api.groq.com/openai/v1`, [OI]-compatible).
- **Anthropic / Claude** — adapter NATIF (bukan [OI]): auth `x-api-key`+`anthropic-version`, endpoint `/v1/messages`, streaming SSE native, normalisasi `content[]`.
- Pertahankan OpenRouter / Gemini / OpenAI + Custom-OI.
- `listModels` / `chatCompletion` / `fetchContextLimit` / `fetchModelPricing` di `providers.js` jadi *adapter-aware* (dispatch berdasarkan `provider.kind`).
- Test: auth header per provider, path discovery, streaming Anthropic, context strategy (tanpa `/api/v0` untuk non-LMStudio), backward-compat DEFAULT_PROVIDERS.

### Status Eksekusi Fase 1 (selesai)
- `js/adapters.js`: ADAPTERS registry (`oi` + `anthropic`) + PROVIDER_DEFS (6 seed) + helper (`getAdapter`, `resolveAuthHeaders`, `readStreamChunk`, `anthropicAuthHeaders`, `normalizeAnthropicText`, `readSSEAnthropic`). Murni (tanpa fetch/DOM).
- `js/providers.js`: DEFAULT_PROVIDERS DERIVED dari PROVIDER_DEFS; `kind` dinormalkan di resolveProviders (`p.kind || 'oi'`); auth per-kind di probeEndpoint/fetchContextLimit/listModels; dispatch Anthropic di puncak chatCompletion + fungsi `anthropicChat()` (auth x-api-key, `/messages`, streaming content_block_delta, normalisasi content[], usage → prompt/completion/total).
- **Bug fix streaming**: `readSSE` + `readSSEAnthropic` kini responsif terhadap 'Berhenti' saat idle antar-token (`readStreamChunk` race abort), dan `readSSEAnthropic` membaca usage dari top-level ATAU `message.usage` (format real Anthropic).
- **Test**: 97/97 pass (asli 75 + 23 baru: `adapters-registry`, `anthropic-native-chat`, `provider-kind-dispatch`).
- **Build**: `npm run build` → `js/app.bundle.js` (114.7kb) + `css/styles.min.css` bersih; kode adapter ter-bundle.
- **Regresi**: nol — 75 test asli tetap pass setelah refactor.

## Fase 2 — Metadata & Rekomendasi Model
- `js/modelRegistry.js`: registry hybrid — ID aktual + metadata (context window, max output, streaming, vision, reasoning, tool-call, pricing) per provider; status availability diperkaya hidup dari `/models`.
- Rekomendasi berdasarkan kebutuhan: Hemat&Cepat, Seimbang, Penalaran Deep, Analisis Dokumen, Vision.
- Badge "Rekomendasi", label capability, estimasi biaya/model.

## Fase 3 — Fallback Aman (dengan approval)
- Trigger: rate limit (429), server down (5xx), model unavailable (404/deprecated), context exceeded, timeout.
- NOT silent: tampilkan dialog → pengguna setujui pindah provider (karena kirim data + API key ke layanan lain).
- Cascade field-stripping intra-provider tetap dipakai dulu sebelum lintas-provider.

## Fase 4 — UI Konfigurasi Sederhana + Lanjutan
- Test Connection, status provider/model, loading state, search+filter (sudah ada), badge rekomendasi, label capability.
- Estimasi token & biaya (sudah ada) diperkaya.
- Panel lanjut: setting manual endpoint + parameter LLM (max_tokens, temp) per model.
- Penjelasan plain-language untuk user nonteknis.

## Fase 5 — Optimasi Prompt Tutor
- Perkuat: "akui bila tak ditemukan di materi", hindari halusinasi, konteks konsisten, dukungan vision & analisis dokumen/long-context.

## Fase 6 — Penguatan Keamanan Proxy
- SSRF guard di `api/proxy` (validasi skema http/https, blokir metadata cloud / internal bila publik).
- Enforse HTTPS untuk endpoint publik; HTTP hanya localhost/LAN.
- Pastikan SSE streaming + timeout/cancellation tetap jalan.

## Fase 7 — Test & Report
- Full suite provider-specific, discovery, auth, streaming/non-streaming, context/rate/timeout/fallback, custom, LM Studio/Ollama, persistensi, socratic quality.
- `npm test` · `npm run build` · cek console error · daftar file berubah · dokumentasi · bug tersisa jujur.

## Catatan Bug Lama (harus tetap terjaga)
- ElectronHub: HTTPS, JANGAN `/api/v0/models`.
- `joinProviderPath` rapatkan path ganda (`/v1/v1` → `/v1`).
- Local AI → jalur langsung (bukan cloud proxy).
