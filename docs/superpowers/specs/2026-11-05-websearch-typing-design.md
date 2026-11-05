# Design: Websearch UX States + Typing Polish (Berhenti/Abort, Staged Status, Cursor, Retry)

**Tanggal:** 2026-11-05
**Branch:** `feat/enhancement`
**Relasi:** kelanjutan spec `2026-11-05-websearch-typing-memory.md` + commit `5be1fd2`.

## Latar Belakang
Commit `5be1fd2` sudah membuat: **sumber web multi-shape** (semua provider), **streaming token-by-token**, dan **memori**. Yang belum tuntas dari requirement asli:

1. **UX states websearch**: indikator *loading / tidak-ditemukan / tidak-didukung* per-jawaban; **snippet** sumber belum tampil; `href` belum divalidasi http(s).
2. **Typing polish**: status **bertahap** ("Menghubungkan ke AI…" → "Sedang menjawab…"), **kursor berkedip**, tombol **Berhenti** yang benar-benar membatalkan request (`AbortController`, bukan sekadar skip animasi), dan tombol **Coba lagi** di jalur kirim utama.

## Prinsip
- **Surgical & generic**: tanpa hardcode provider, minimal churn.
- Tetap vanilla ES Modules, tanpa build step; UI bahasa Indonesia.
- `prefers-reduced-motion` sudah global → semua animasi baru mematuhinya.

## Rancangan Perubahan

### A. Websearch — snippet + validasi href + state per-jawaban
**`js/chat.js` — `renderSources(msg, sources, { onSave })`**:
- **Validasi href**: `a.href` hanya dipasang bila url `http(s)`; bila non-http/raw (mis. shape `fromGroundingMetadata` tanpa skema), tampilkan judul + snippet sebagai **teks** (bukan link) agar tidak ada tautan rusak.
- **Snippet**: tampilkan `<p class="msg__sources-snippet">` di bawah tiap tautan, di-escape + pangkas ~200 karakter; judul & snippet aman (textContent / `escapeHtml`).

**State per-jawaban** — simpan flag `webSearch: true|false` pada `state.messages[i]` (pesan model) agar indikator stabil saat render ulang (muat sesi / regenerasi / edit). Indikator muncul di dalam bubble, sebelum blok sumber:
- **loading** (menjawab, websearch ON): "Mencari sumber web…"
- **not-found** (websearch ON, `sources.length === 0`): "Tidak ada sumber web."
- **unsupported** (websearch ON, `provider.supportsGrounding === false`): "Sumber web tidak didukung endpoint ini."

Logika di `sendUserMessage` / `generateGreeting`: bubble dibuat → indikator *loading* tampil; setelah answer → ubah ke not-found / unsupported / tampilkan sumber.

### B. Typing — staged status + cursor + Berhenti + Retry
**AbortController (thread dari app.js → providers.js)**:
- State modul-level `let abortCtl = null`.
- `sendUserMessage` / `generateGreeting`: `abortCtl = new AbortController()`, lewatkan `signal: abortCtl` ke `providerChat(...)` → `chatCompletion(...)` → `buildChatRequest(...)` → `fetch(url, { ..., signal })`.
- `readSSE(res, onDelta, signal)`: terima `signal`; cek `signal.aborted` di loop; tangkap `AbortError` → kembalikan `{ text, usage, sources }` **parsial** (bukan throw).
- **Berhenti** = `abortCtl.abort()` + set flag `userStopped`, reset setelahnya. Partial text tetap disimpan sebagai balasan (dperlakukan sebagai *stop-user*, bukan error).

**Staged status** — `insertBubbleTyping` / `showTyping`: tambah elemen `.typing__status`:
- Awal: "Menghubungkan ke AI…"
- Saat delta pertama (`onDelta`): ganti → "Sedang menjawab…"
- Hapus saat selesai.

**Blinking cursor** — caret di typing indicator + CSS `.typing__caret` (blink), hormati `prefers-reduced-motion`.

**Tombol Berhenti** — `updateComposer()`: bila busy, tampilkan tombol **"Berhenti"** (bukan "Kirim" disabled); handler → `stopGeneration()` = abort + simpan parsial. Toggle Kirim ↔ Berhendi.

**Retry jalur utama** — `sendUserMessage` catch: panggil `showRetry()` saat error **dan bukan user-stop**; user-stop tidak tampilkan retry (balasan parsial sudah tersimpan).

## Verifikasi
- **Unit**: `node --test tests/*.mjs` — tambah uji validasi href + escape snippet (`renderSources`), partial-on-abort `readSSE`.
- **Manual/Playwright**: streaming visual, Berhenti membatalkan (parsial tersimpan), staged status, kursor berkedip, retry, state websearch (loading / not-found / unsupported / snippet).

## Catatan Implementasi
- Jangan `git add -A`; stage eksplisit, `.idea/` tetap untracked.
- Partial-on-abort: bedakan `AbortError` (stop-user) dari error lain (sistem) agar UI & riwayat konsisten.
