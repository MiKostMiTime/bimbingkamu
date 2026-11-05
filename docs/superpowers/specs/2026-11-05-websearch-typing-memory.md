# Spec: Websearch Grounding + Typing Token-by-Token + Memori

**Tanggal:** 2026-11-05
**Branch:** `feat/enhancement`
**Status:** disetujui user (05-11-2026)

## Latar Belakang
Fitur "Cari web untuk pelengkap" (grounding/websearch) praktis **tidak pernah**
menampilkan sumber, dan animasi typing streaming terasa berat (full re-render per
delta). Ditambah permintaan: chat mengingat identitasnya lintas sesi (memori).

## Keputusan User
- Websearch: **semua provider**, jalur **streaming + non-stream**, sumber **kredibel**
  (URL real, judul jelas, dedup, tidak dikarang). Dibangun defensif (multi-shape).
- Ruas: **ketiga fitur sekaligus** dalam 1 branch/commit.
- Tampilan: chip sitasi (judul+URL) + "＋ Simpan ke materi" (sudah ada), sederhana untuk SMA.

## Root Cause Websearch
1. Jalur SSE hardcode `sources: []` (`providers.js`). Streaming = path default → sumber ~0%.
2. Jalur non-stream baca `data.candidates[0]`, tapi endpoint OpenAI-compatible kirim `choices` → selalu `[]`.
3. Hanya `ep-gemini` yang `supportsGrounding: true` → tools `google_search` tak pernah dikirim ke provider lain.
4. `extractSources()` hanya paham native-Gemini `groundingMetadata`; path `/v1beta/openai` kirim shape berbeda.

## Rancangan Perubahan (surgical)

### A. Websearch — sumber kredibel, multi-shape
**`js/api.js`** — `extractSources(input)` jadi auto-detect:
- `input.groundingMetadata` → jalur native (TETAP, output sama dengan uji lama).
- `Array.isArray(input.citations)` → OpenAI-compatible Gemini (`{uri,title}`).
- `input.grounding_metadata.groundingChunks` → bungkus jadi native.
- `Array.isArray(input.tool_calls)` → generic tool-calls (best-effort).
Dedup per URL, maks 6, `{url, title, snippet}`; hanya URL http(s) → kredibel.

**`js/providers.js`**:
- `DEFAULT_PROVIDERS`: `supportsGrounding: true` pada `ep-openrouter` & `ep-openai` (sebelumnya false). `ep-gemini` tetap true. Custom pakai flag masing-masing.
- `readSSE()`: tangkap sumber dari tiap chunk (`ev.citations`, `ev.choices[0].message.*`), kembalikan `sources`.
- `chatCompletion` streaming: `sources: streamed.sources || []` (hapus hardcode `[]`).
- non-stream: extractor unified — cek `candidates` (native) ATAU `citations`/`tool_calls` (OpenAI).

### B. Typing token-by-token
**`js/chat.js`**: `renderRich(el, text, { skipMath })` — bila `skipMath`, render markdown tanpa hydrate KaTeX (ringan).
**`js/app.js`** (`onDelta` streaming): throttle paint maks ±50 ms / ~3 kata, `skipMath: true` saat live; KaTeX di-hydrate sekali di render final. Rasa token-by-token mulus, CPU ringan, tak berkedip.

### C. Memori (identitas lintas sesi)
**`js/memory.js`** baru: simpan anchor persona + catatan ke `localStorage` (`tb_memory`).
**`js/prompt.js`**: `buildSystemPrompt` prepends blok memori bila ada → model mengingat "kunya siapa" tiap sesi. Seed default persona TanyaBukan.

## Verifikasi
- Unit: `node --test tests/*.mjs` (tambah uji multi-shape extractSources + streaming capture; memori).
- Manual: browser, websearch ON di Gemini/OpenRouter, cek chip sumber + simpan ke materi + typing mulus + identitas tetap ada setelah reload.

## Catatan
- Jangan `git add -A`; stage eksplisit, `.idea/` tetap untracked.
- Vanilla JS ES Modules, tanpa build step; UI bahasa Indonesia.
