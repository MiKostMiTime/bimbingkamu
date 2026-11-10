# P0 — Streaming Proxy (catatan eksekusi)

**Tujuan:** `/api/proxy` selama ini mem-buffer seluruh respons (`net.text()`) lalu
mengembalikannya sebagai envelope JSON. Untuk chat streaming (SSE) ini membunuh
delta live + membatasi di 60s serverless Vercel.

## Perubahan
1. `api/proxy/index.js`:
   - Deteksi target streaming via `content-type` (`text/event-stream`, `application/x-ndjson`).
   - Mode stream → **passthrough** (tulis chunk mentah ke `res` satu per satu).
   - Mode non-stream → envelope JSON (tetap kompatibel, mis. GET `/models`).
   - `AbortController` timeout (~120s, bisa via `?timeoutMs=`) → `proxyStatus:'timeout'`.
2. `js/providers.js` `proxyFetch()`:
   - Deteksi stream-vs-envelope dari `content-type`; stream dilewatkan utuh ke
     `chatCompletion` → `readSSE`.

## Uji (TDD)
- `tests/proxy-stream.test.js`: passthrough + delta live + proxy timeout.
- Regresi: `node --test` (6/6) + `node test-providerfetch.mjs` (4/4).

## Status
- [x] P0 implement + test hijau
- [ ] P1 deteksi tunnel (regex + header bypass)
- [ ] P2 predeploy hook + fix minor
