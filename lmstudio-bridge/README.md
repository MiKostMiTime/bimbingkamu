# BimbingKamu - LM Studio Bridge (Ekstensi Chrome)

Versi **1.1.0**. Ekstensi **Chrome / Edge** (MV3) untuk menghubungkan BimbingKamu
yang berjalan di HTTPS (Vercel) ke **LM Studio lokal** (`http://localhost:1234`)
atau lewat **ngrok** (`https://*.ngrok-free.dev`, `https://*.ngrok-free.app`),
tanpa masalah **CORS** & **Private Network Access**.

## Cara Kerja

BimbingKamu memanggil `fetch()` ke endpoint. Ekstensi mengganti `window.fetch`
di dunia utama (MAIN world) halaman, lalu mengalihkan permintaan ke *background*
extension yang punya izin (`host_permissions`) untuk menjangkau localhost/ngrok.
Karena berjalan di konteks extension, **CORS halaman tidak memblokir respons**,
jadi LM Studio/Ollama tanpa header `Access-Control-Allow-Origin` tetap bisa
dibaca — termasuk chat streaming (SSE).

## Pemasangan (Load Unpacked) — Tanpa Terminal

1. Buka Chrome / Edge, ketik di baris alamat: `chrome://extensions`
   (Edge: `edge://extensions`).
2. Aktifkan **Mode pengembang** (*Developer mode*) di kanan atas.
3. Klik **Muat yang tak terurai** (*Load unpacked*).
4. Pilih folder **`lmstudio-bridge`** ini, lalu **Klik Muat** (*Load*).
5. Ekstensi **BimbingKamu - LM Studio Bridge** muncul di daftar dengan versi
   **1.1.0**. Pastikan saklarnya ON.

## Penggunaan

1. Buka BimbingKamu (mis. `https://<namadomain>.vercel.app`).
2. Klik menu **Pengaturan**, bagian **Endpoint & Model**.
3. Masukkan Base URL endpoint:
   - Lokal: `http://localhost:1234`
   - Via ngrok: `https://<id-ngrok>.ngrok-free.app`
4. Klik **Tambah / Simpan** → daftar model otomatis muncul (dengan indikator
   muat di atas panel).
5. Pilih model & mulai chat.

## Endpoint yang Didukung Otomatis

- `http://localhost:*`, `http://127.0.0.1:*`, `http://0.0.0.0:*`
- `https://*.ngrok-free.dev`, `https://*.ngrok-free.app`
- `https://*.ngrok.dev`, `https://*.ngrok.app`, `https://*.ngrok.io`
- `https://*.ngrok-free.pizza`, `https://*.ngrok.pizza`

Untuk host khusus (domain custom / IP lain), tambahkan polanya di
`main.js` → array `TARGET_HOSTS`, lalu muat ulang tab BimbingKamu.

## File

| File | Peran |
| --- | --- |
| `manifest.json` | Konfigurasi ekstensi (izin, script). |
| `main.js` | Content script: mengganti `window.fetch` → alihkan ke background. |
| `background.js` | Service worker: mengambil request ke endpoint tanpa CORS. |

## Catatan

- Butuh **Chrome / Edge** (basis MV3). Firefox butuh konversi ke WebExtension MV3.
- Bila chat tidak berhenti saat tombol *Berhendi* ditekan, muat ulang tab — fitur
  abort mid-stream bergantung pada koneksi port yang masih aktif.
- Debug di console: `__bkbBridgeDebug.isTargetUrl('http://localhost:1234')`,
  `.size()` (jumlah request aktif), `.refreshPort()`.

## Pemecahan Masalah

Cek di console halaman BimbingKamu:

```js
__bkbBridgeDebug.version   // harus '1.1.0'
__bkbBridgeDebug.isTargetUrl('https://contoh.ngrok-free.dev/v1/models') // harus true
```

- **`version` bukan `1.1.0`** → browser masih memakai salinan lama. Buka
  `chrome://extensions`, hapus ekstensi BimbingKamu yang lama (bisa ada dua
  kartu), lalu *Load unpacked* folder hasil ekstrak versi 1.1.0.
- **`__bkbBridgeDebug` undefined** → content script tidak menyuntik. Pastikan
  tab dibuka di `localhost`, `127.0.0.1`, atau `*.vercel.app`, lalu muat ulang.
- **`isTargetUrl` true tapi masih CORS** → pastikan `background.js` tidak error
  (buka *service worker* dari kartu ekstensi) dan `host_permissions` sudah
  memuat domain ngrok tersebut.
- Content script hanya menyuntik saat halaman dimuat. Setelah mengubah atau
  memasang ulang ekstensi, selalu **muat ulang tab** (Cmd/Ctrl+Shift+R).
