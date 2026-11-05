# Rancangan: TanyaBukan → PWA Offline-Ready

**Tanggal:** 2026-11-05
**Branch:** `feat/enhancement` (HEAD `0afee9a`)
**Status:** Disetujui pengguna

---

## 1. Ringkasan
Mengubah TanyaBukan (app statik BYOK tutor Socratic) menjadi **Progressive Web App** yang:
- Bisa **di-install** ke layar utama (home screen) → terasa seperti app native.
- Menjalankan **antarmuka offline** (app shell + aset lokal di-cache).
- Menjaga **memori + setting + materi tetap ada** saat app di-update atau di-reinstall.

Fokus: *app shell installable + offline UI*, bukan "study fully offline" (panggilan endpoint provider tetap butuh jaringan karena modelnya di cloud/lokal-user).

---

## 2. Tujuan & Non-Tujuan

### Tujuan
- [ ] App installable (manifest + ikon) → muncul opsi "Tambah Layar Utama"/"Install App".
- [ ] Antarmuka + aset lokal (CSS/JS/vendor/ikon/manifest) tersedia **offline** via Service Worker.
- [ ] Update app tidak membuang data pengguna (memori/setting/materi di localStorage).
- [ ] Ikon baru `TanyaBukan` (192 / 512 / maskable-1024 PNG), sesuai tema indigo.
- [ ] Deteksi update SW + opsional tombol "Install" eksplisit.

### Non-Tujuan (sesuai keputusan)
- [ ] **Tidak** menyimpan riwayat percakapan aktif ke cache (hanya memori/setting/materi).
- [ ] **Tidak** meng-cache jawaban model / panggilan API cross-origin (tetap network).
- [ ] Tidak menambah dependency eksternal (workbox dll.) — SW ditulis manual, tetap *zero-CDN*.

---

## 3. Arsitektur & File

| Aksi | File | Peran |
|---|---|---|
| Buat | `manifest.json` | Metadata install: nama, tema, `display: standalone`, start_url, ikon. |
| Buat | `sw.js` | Service Worker: precache app shell + aset, strategi cache per-skema, versioning. |
| Buat | `js/pwa.js` | Registrasi SW, deteksi update (prompt refresh), helper install. Dimuat sebagai module. |
| Buat | `icons/icon-192.png`, `icons/icon-512.png`, `icons/maskable-1024.png` | Ikon PWA hasil desain baru. |
| Ubah | `index.html` | `<link rel="manifest">`, meta `theme-color`, registrasi `./js/pwa.js`. |
| Ubah (defensif) | `js/memory.js` | *Version guard* ringan: validasi/migrasi skema storage agar tidak error setelah update kode. |

### Konsistensi dengan eksisting
- **CSP** di `index.html` sudah memuat `manifest-src 'self'` dan `worker-src 'self'`, serta `script-src 'self'`. Karena manifest, SW, & `pwa.js` semua **same-origin (lokal)**, tidak perlu mengubah CSP.
- **Path relatif** sudah dipakai di seluruh app → cache SW dengan URL relatif jalan mulus.
- **Vendor lokal (272 file)** → bisa di-cache untuk offline shell tanpa CDN.
- **localStorage** (`tanyabukan.*`) terpisah dari `CacheStorage` → selamat dari update SW & reinstall secara alami.

---

## 4. Service Worker — Strategi

### 4.1 Versioning cache
- Nama cache dengan versi statik: `tanyabukan-shell-v1`.
- Saat isi `sw.js` berubah (byte berbeda) → browser menganggap SW baru → cache lama (`-v1`) dihapus otomatis saat yang baru aktif. **localStorage tidak terpengaruh** → data pengguna aman.

### 4.2 Sauran cache per skema (strategy)
| Kategori | Strategi | Alasan |
|---|---|---|
| Aset sendiri (CSS/JS/vendor/ikon/manifest/index.html) | **Cache-first, stale-while-revalidate** | Offline siap; update aset tetap terambil nanti. |
| `worker-src` / SW itu sendiri | **Network-only** | Memastikan SW selalu versi terbaru. |
| API cross-origin (`connect-src`: https/http endpoint provider) | **Network-first + fallback cache** | Jawaban model harus dari jaringan; bila offline, tampilkan state graceful (bukan cache jawaban lama). |

### 4.3 Offline fallback
- Saat request aset sendiri gagal & tidak ada di cache → balas dengan `index.html` (SPA-style shell fallback).

### 4.4 Install precache
- Pada event `install`: precache **inti app shell** (index.html, CSS, JS, ikon, manifest). **Vendor** di-cache *on-demand* dengan strategi cache-first (cache saat pertama dikunjungi), sehingga offline penuh bekerja setelah kunjungan online pertama — tanpa membebani muat ulang awal.

---

## 5. Manifest & Ikon

### `manifest.json`
```jsonc
{
  "name": "TanyaBukan — Tutor Socratic",
  "short_name": "TanyaBukan",
  "description": "Tutor Socratic berbasis materi milikmu sendiri. Bimbing, bukan jawab.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",        // rasa app native (tanpa chrome browser)
  "orientation": "portrait-primary",
  "background_color": "#FAFAFA",  // --color-bg
  "theme_color": "#4F46E5",       // --color-accent (indigo)
  "icons": [
    { "src": "./icons/icon-192.png",   "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "./icons/icon-512.png",   "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "./icons/maskable-1024.png","sizes": "1024x1024","type":"image/png","purpose": "maskable" }
  ]
}
```

### Ikon baru
- **Konsep:** gelembung percakapan + motif "?" / buku, warna tema indigo (`#4F46E5`) + aksen `#C7D2FE`, latar `#FAFAFA`.
- **Output:** `icon-192.png`, `icon-512.png`, `maskable-1024.png` (maskable agar tidak kepotong di home screen Android).
- Disiapkan pada tahap implementasi (setujui desain ini dulu).

---

## 6. Jaminan Data Tidak Hilang

1. **localStorage vs CacheStorage terpisah** → update/reinstall SW tidak menghapus `tanyabukan.*` (memoria/setting/materi).
2. **Version guard di `memory.js`:** simpan `{ v: 1, persona, notes }`; saat dibaca, cek versi & migrasi bila perlu → skema lama tidak error setelah kode update.
3. **Reinstall dari home screen:** data inti tetap ada selama browser tidak di-"clear site" manual (di luar kendali app; info ke user via toast bila perlu).

---

## 7. Rencana Uji (verifikasi sebelum klaim "selesai")

| # | Uji | Cara | Hasil yang diharapkan |
|---|---|---|---|
| 1 | Installability | DevTools → *Manifest* / Lighthouse PWA | Muncul "Install TanyaBukan"; ikon benar. |
| 2 | Offline shell | DevTools → **Offline** → refresh | UI + materi tampil; endpoint graceful (bukan crash). |
| 3 | Update SW | Ubah `sw.js` → reload | Cache `-v1` lama hapus, app jalan, **localStorage (memoria/setting/materi) masih ada**. |
| 4 | Data utuh | Simulasi reinstall / cache-clear parsial | Memori persona + setting endpoint + materi tetap terbaca. |
| 5 | CSP aman | Buka di mode incognito + load penuh | Tidak ada error CSP untuk manifest/SW/ikon. |

> Uji dijalankan via `node --check` (syntax) + manual browser; unit test existing (`tests/*.test.mjs`) tetap pass, termasuk `memory.test.mjs` setelah version guard.

---

## 8. Risiko & Mitigasi
- **Vendor besar (272 file)** → precache semua bisa berat pertama kali. *Mitigasi:* precache app shell + ikon + css/js; vendor di-cache on-demand (cache-first) agar cepat, tetap offline setelah dikunjungi.
- **CSP `manifest-src`/`worker-src`** → sudah ada; tetap verifikasi tidak ada blokir saat deploy Vercel (header CSP dari Vercel harus kompatibel / atau manifest SW dilayani dengan header benar).
- **Update SW yang user belum refresh** → `pwa.js` mendeteksi `waiting` state & tampilkan prompt "Versi baru tersedia → Muat ulang" agar fitur baru aktif tanpa clear manual.

---

## 9. Urutan Implementasi (ringkas)
1. Desain + produksi ikon (`icons/`).
2. Buat `manifest.json`.
3. Buat `sw.js` (precache + strategi cache + versioning).
4. Buat `js/pwa.js` (registrasi + deteksi update + opsional tombol Install).
5. Ubah `index.html` (link manifest, meta theme-color, registrasi pwa.js).
6. Tambah version guard di `js/memory.js` + uji (`memory.test.mjs`).
7. Uji manual (offline / update / install) + Lighthouse PWA.
8. Commit; siap deploy ke Vercel.
