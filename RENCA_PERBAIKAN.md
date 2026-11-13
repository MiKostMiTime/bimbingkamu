# RENCANA PERBAIKAN — Pencarian Web (Tavily) BimbingKamu

**Status:** ✅ VERIFIKASI SELESAI — **6 PASS / 0 FAIL** (mode SERVER + BYOK).
**Tanggal:** 2026-11-14 · **Key:** `tvly-3SLWac-y6InXpeBxvrGdlY6hcICWWw7azONxRJgm8DjKUrYpV`

## 1. Masalah (diagnosis)
Pencarian web secara default **tampil "belum aktif"** di UI karena tiga syarat `effectiveWebSearch()` belum terpenuhi:
1. Toggle "Cari web" → ✅ default ON
2. Provider aktif mendukung tools (`kind === 'oi' | 'anthropic'`) → ✅ `ep-openrouter` terpilih
3. Backend siap (`configured:true`) → ❌ **belum ada kunci Tavily**

Jadi bukan bug kode; hanya **kunci belum dikonfigurasi**.

## 2. Perubahan yang dibuat (fix)
| File | Perubahan |
|------|-----------|
| `.env` | Menambahkan `TAVILY_API_KEY=tvly-3SLWac…` (gitignored → aman, tidak ter-commit). Mode server membacanya ke `process.env`. |
| `scripts/dev-server.mjs` | Menambahkan `loadDotEnv()` — loader `.env` bawaan Node (tanpa dependensi baru) yang **tidak menimpa** env asli / Secret Cloudflare. Sekarang `npm run dev` otomatis membaca kunci. |

## 3. Hasil verifikasi (E2E, Playwright + UI sungguhan)
```
PASS MODE SERVER — GET /api/search → configured:true
PASS MODE SERVER — POST /api/search → ok:true + results>0 (count=5)
PASS MODE BYOK    — #searchKeyInput change → simpan ke localStorage
PASS MODE BYOK    — #webSearchHint → "Tutor boleh mencari web…"
PASS MODE BYOK    — searchWeb() round-trip browser→api.tavily.com → hasil>0 (real data integral SMA)
PASS MODE BYOK    — cache memori: panggilan ulang → cached:true
```
Laporan HTML sample hasil: `tmp/e2e-search-report.html`.

## 4. Cara mengaktifkan (pilih salah satu, atau keduanya)
**A. Mode OK / BYOK (tanpa deploy):** Settings → “Kunci Tavily” → tempel key → reload → websearch langsung jalan (browser fetch langsung ke Tavily). CSP `connect-src 'self' https:` sudah mendukungnya.

**B. Mode Server:** `TAVILY_API_KEY` di `.env` (lokal) → atau **Secret** di Cloudflare Pages Dashboard (produksi, agar tak ter-expose & tak ikut bundle):
- Lokal: `npx wrangler pages secret put TAVILY_API_KEY --local` untuk Pages Functions lokal, atau isi via dashboard Secrets.

## 5. Langkah selanjutnya (opsional / ops-finalize)
1. Deploy `.env` + `dev-server.mjs` ke repo; tambahkan Secret di dashboard Cloudflare Pages → `TAVILY_API_KEY`.
2. Opsional: catat singkat di `README.md` bagian "Konfigurasi Kunci Tavily".
3. Opsional (regresif): simpan E2E di `tests/` sebagai skrip tetap (saat ini temp, sudah dihapus).
