# BimbingKamu - LM Studio Bridge (Ekstensi Chrome)

Versi **1.2.0**. Ekstensi **Chrome / Edge** (MV3) untuk menghubungkan BimbingKamu
yang berjalan di HTTPS (Vercel) ke **LM Studio lokal** (`http://localhost:1234`),
**LAN IP** (`http://10.x.x.x:1234`, `http://192.168.x.x:1234`), atau lewat
**ngrok** (`https://*.ngrok-free.dev`, `https://*.ngrok-free.app`), tanpa masalah
**CORS** & **Private Network Access**.

## Cara Kerja

BimbingKamu memanggil `fetch()` ke endpoint. `main.js` mengganti `window.fetch`
di dunia utama (MAIN world) halaman, lalu mengirim permintaan ke `relay.js` di
dunia ISOLATED lewat `window.postMessage`. Relay memegang port ke *background*
extension yang punya izin (`host_permissions`) untuk menjangkau localhost, LAN
IP, dan ngrok. Karena berjalan di konteks extension, **CORS halaman tidak
memblokir respons**, jadi LM Studio/Ollama tanpa header
`Access-Control-Allow-Origin` tetap bisa dibaca, termasuk chat streaming (SSE).

Pemisahan ini wajib: script di MAIN world **tidak punya** `chrome.runtime`,
sedangkan script di ISOLATED world punya. Dulu `main.js` memanggil
`chrome.runtime.connect()` langsung, gagal, lalu diam-diam jatuh ke `fetch`
biasa (gejala: `main.js:235 ... net::ERR_FAILED`).

## Pemasangan (Load Unpacked) — Tanpa Terminal

1. Buka Chrome / Edge, ketik di baris alamat: `chrome://extensions`
   (Edge: `edge://extensions`).
2. Aktifkan **Mode pengembang** (*Developer mode*) di kanan atas.
3. Klik **Muat yang tak terurai** (*Load unpacked*).
4. Pilih folder hasil ekstrak **yang berisi `manifest.json`**, lalu **Klik Muat**
   (*Load*).
5. Ekstensi **BimbingKamu - LM Studio Bridge** muncul di daftar dengan versi
   **1.2.0**. Pastikan saklarnya ON.

## Penggunaan

1. Buka BimbingKamu (mis. `https://<namadomain>.vercel.app`).
2. Klik menu **Pengaturan**, bagian **Endpoint & Model**.
3. Masukkan Base URL endpoint:
   - Komputer ini: `http://localhost:1234` atau `http://127.0.0.1:1234`
   - Perangkat lain di Wi-Fi yang sama: `http://<IP-komputer>:1234`
   - Via ngrok: `https://<id-ngrok>.ngrok-free.app`
4. Klik **Tambah / Simpan** → daftar model otomatis muncul (dengan indikator
   muat di atas panel).
5. Pilih model & mulai chat.

## Endpoint yang Didukung Otomatis

- `http://localhost:*`, `http://127.0.0.1:*`, `http://0.0.0.0:*`, `http://[::1]:*`
- IP privat: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`,
  `100.64.0.0/10` (Tailscale)
- Nama mDNS: `*.local`
- `https://*.ngrok-free.dev`, `https://*.ngrok-free.app`
- `https://*.ngrok.dev`, `https://*.ngrok.app`, `https://*.ngrok.io`
- `https://*.ngrok-free.pizza`, `https://*.ngrok.pizza`

Chrome match pattern tidak mendukung CIDR, jadi `host_permissions` ekstensi
memakai `http://*/*` dan `https://*/*`. Deteksi target tetap dibatasi di
`main.js` (`isTargetHost`), sehingga permintaan halaman lain tidak ikut
dialihkan. Untuk domain custom, tambahkan polanya di `TARGET_HOSTS`, lalu muat
ulang tab BimbingKamu.

## File

| File | Peran |
| --- | --- |
| `manifest.json` | Konfigurasi ekstensi (izin, script). |
| `main.js` | Content script MAIN world: mengganti `window.fetch` → kirim ke relay. |
| `relay.js` | Content script ISOLATED world: jembatan `postMessage` ke port background. |
| `background.js` | Service worker: mengambil request ke endpoint tanpa CORS. |

## Catatan

- Butuh **Chrome / Edge** (basis MV3). Firefox butuh konversi ke WebExtension MV3.
- Tombol *Berhendi* memutus fetch dan stream lewat `AbortController` serta
  `reader.cancel()`. Bila stream tetap berjalan, muat ulang tab.
- Debug di console: `__bkbBridgeDebug.isTargetUrl('http://localhost:1234')`,
  `.size()` (jumlah request aktif), `.refreshPort()`.

## Pemecahan Masalah

Cek di console halaman BimbingKamu:

```js
__bkbBridgeDebug.version   // harus '1.2.0'
__bkbBridgeDebug.isTargetUrl('http://10.60.196.101:1234/models') // harus true
__bkbBridgeDebug.isTargetUrl('https://contoh.ngrok-free.dev/v1/models') // harus true
```

- **`version` bukan `1.2.0`** → browser masih memakai salinan lama. Buka
  `chrome://extensions`, hapus ekstensi BimbingKamu yang lama (bisa ada dua
  kartu), lalu *Load unpacked* folder hasil ekstrak versi 1.2.0.
- **`__bkbBridgeDebug` undefined** → content script tidak menyuntik. Pastikan
  tab dibuka di `localhost`, `127.0.0.1`, atau `*.vercel.app`, lalu muat ulang.
- **`isTargetUrl` true tapi request gagal** → pastikan `background.js` tidak
  error (buka *service worker* dari kartu ekstensi). Untuk LAN, pastikan server
  LM Studio mengizinkan akses jaringan lokal dan port 1234 tidak diblokir firewall.
- Content script hanya menyuntik saat halaman dimuat. Setelah mengubah atau
  memasang ulang ekstensi, selalu **muat ulang tab** (Cmd/Ctrl+Shift+R).
