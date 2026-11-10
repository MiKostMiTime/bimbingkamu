# P2 — Deploy staleness hook + minor fixes (catatan eksekusi)

**Tujuan:** Vercel men-deploy `js/app.bundle.js` yang DI-COMMIT (bukan source).
Bila developer ubah source tapi lupa rebuild+commit → bundle tua tayang. P2
menambahkan: (1) hook predeploy, (2) fix minor di normalizeEndpointUrl + cascade retry.

## Item 1: scripts/predeploy.mjs (hook staleness bundle)
- Jalankan build (esbuild) → regenerasi js/app.bundle.js + css/styles.min.css.
- Bandingkan mtime bundle vs source (js/*.js, css/*). Bila source lebih baru
  dari bundle → bundle STALE → fail (exit 1) agar deploy tidak kirim kode tua.
- Wire ke package.json: `npm run predeploy`.

## Item 2: normalizeEndpointUrl single-word host (concrete bugs found)
Probe menunjukkan:
- `HTTPS://Example.COM/v1/` -> `HTTPS://Example.COM/v1`  (skema+host TIDAK lowercase)
- `example.com//v1//`       -> `https://example.com//v1` (slash ganda internal tersisa)
- `DESKTOP-ABC123`          -> `http://DESKTOP-ABC123`   (single-word host case)
Fix: normalisasi skema+host lowercase + rapatkan slash ganda di path (semua cabang).

## Item 3: double-proxy retry chatCompletion cascade
Setiap stripped-field retry (400/413/422) memanggil providerFetch → re-race
direct(12s)→proxy. Untuk endpoint remote (ngrok/tunnel) ini lambat & boros.
Ukur dulu via test, lalu optimasi: retry pakai proxyFetch langsung bila request
pertama sudah lewat proksi (endpoint publik), tetap providerFetch untuk lokal.

## Status
- [x] Item 1 predeploy.mjs + test (6/6) — `npm run predeploy` rebuild + freshness gate; wire ke package.json.
- [x] Item 2 normalizeEndpointUrl + test (8/8) — skema+host lowercase, slash ganda dirapatkan, single-word host.
- [x] Item 3 double-proxy retry + test (2/2) — catat viaProxy di toProxy(); cascade retry reuse proxyFetch()
  langsung bila request pertama lewat proksi (endpoint remote), hindari re-race direct→proxy. Lokal tetap
  providerFetch (perilaku lama). Ukur: remote+tools-400 → sebelum fix direct=2/proxy=2, sesudah direct=1/proxy=2.
- [x] node --test: 30/30 hijau + test-providerfetch.mjs: 4/4.
- [ ] rebuild bundle + commit (selesai di akhir).
