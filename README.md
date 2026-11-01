# TanyaBukan

Tutor belajar Socratic berbasis RAG untuk siswa SMA Indonesia. Alih-alih langsung menjawab, TanyaBukan membimbingmu menemukan jawaban **dari materi milikmu sendiri** — lebih dalam dan lebih fokus, dengan halusinasi yang ditekan lewat batasan prompt dan penandaan kutipan yang tidak ditemukan di materi (bukan jaminan mutlak).

Proyek ini memakai skema **BYOK** (Bring Your Own Key): kamu memasukkan kunci API Gemini milikmu, yang hanya tersimpan di `localStorage` browser dan hanya dikirim ke `generativelanguage.googleapis.com`. Tidak ada backend, tidak ada server, tidak ada pelacakan.

## Menjalankan

Tidak ada build step. Jalankan local server apa pun di folder ini:

```bash
python3 -m http.server 5500
# atau
npx serve .
```

Lalu buka <http://localhost:5500>.

> Wajib memakai server (bukan buka file langsung), karena aplikasi memakai ES Modules yang diblokir pada `file://`.

### Mendapatkan kunci API

1. Buka [aistudio.google.com](https://aistudio.google.com/app/apikey) dan login dengan akun Google.
2. Klik **Create API key**, salin kuncinya.
3. Tempel di panel **Kunci API** pada aplikasi. Kuota gratis tersedia; jika habis, coba lagi keesokan hari.

> **Penting untuk siswa SMA:** periksa syarat penggunaan Google AI Studio/Gemini API (termasuk batas usia akun dan penggunaan data pada paket gratis). Jika siswa di bawah usia yang disyaratkan, guru atau orang tua sebaiknya menyediakan kunci.

## Men-deploy

Aplikasi ini sepenuhnya statis. Upload seluruh isi folder ke hosting statis mana pun: GitHub Pages, Netlify, Vercel, Cloudflare Pages. Pastikan path relatif tetap utuh (struktur folder `css/`, `js/`, `assets/` tidak boleh diubah).

## Daftar fitur

- **BYOK** — input kunci API dengan toggle lihat/sembunyikan, tersimpan otomatis di `localStorage`, indikator privasi, dan tombol hapus semua data.
- **Materi (RAG)** — **lampirkan file** `.txt`/`.md`/`.pdf`/`.docx` (drag & drop atau klik; teks PDF diekstrak via pdf.js, .docx via mammoth — semua di browser). File tampil sebagai **chip** (nama + jumlah karakter + tombol lepas) — teks hasil ekstraksi **tidak ditampilkan** di panel, tapi tetap ikut dikirim ke model. File **spesifik per sesi chat** (tiap chat punya lampirannya sendiri). Penghitung karakter real-time, tersimpan antar sesi.
- **Pengaturan belajar** — 4 mode (Paham Konsep, **Penjelasan** — penjelasan tuntas tanpa interogasi, Latihan Soal, Persiapan Ujian), slider kedalaman bimbingan 1–5 (mengubah aturan prompt; parameter temperature tidak dipakai lagi karena deprecated di Gemini 3.6+, diganti `thinkingLevel` per mode), pilihan model Gemini — daftarnya **disegarkan otomatis dari API** sesuai kunci, jadi model yang sudah dinonaktifkan Google tidak lagi ditawarkan (bebas error 404).
- **Cari web (grounding)** — toggle "Cari web untuk pelengkap" memakai Google Search grounding bawaan Gemini API (sumber dari ranking Google, tanpa API key kedua). Tautan sumber tampil sebagai blok "Sumber" di bawah balasan + tombol **＋ Simpan ke materi** yang menambahkannya ke materi sesi (tampil sebagai chip `web-rujukan.md`, bisa dilepas).
- **Riwayat sesi** — sidebar kiri menampilkan semua sesi (judul otomatis dari pertanyaanmu + tanggal relatif, maks. 50); klik untuk membuka kembali, hapus per sesi, auto-save tiap giliran, migrasi otomatis dari format versi lama.
- **Percakapan** — multi-turn, render markdown + sanitasi, **rumus LaTeX tampil sebagai rumus visual via KaTeX** (dimuat on-demand; offline tetap terbaca sebagai teks mentah), kutipan materi `[[...]]` disorot sebagai chip (yang tidak ditemukan di materi diberi tanda *belum terverifikasi*), efek mengetik progresif dengan tombol Lewati, sapaan pembuka otomatis.
- **Data & statistik** — timer waktu aktif (berhenti saat idle/tab tersembunyi), penghitung petunjuk, penghitung giliran dialog, ekspor percakapan ke file `.md` (bagian dari eksperimen STEM).
- **Pengalaman** — onboarding 3 langkah, empty state, toast, error ramah per jenis (kunci salah / kuota habis / model tak tersedia / server sibuk / jaringan), semua panel setting (kunci API, materi, mode/level/model) terpusat di **drawer kanan** yang dibuka tombol gear — trigger & panel sepihak, kunci tidak tergeletak di layar utama; sidebar riwayat bisa diratakan di layar lebar (drawer di HP ≤640px); halaman terkunci sehingga hanya kotak chat yang digulir — seperti aplikasi chat, aksesibilitas keyboard + focus state + kontras AA.

## Struktur folder

```
tanyabukan/
├── index.html          # markup, muat CSS + 2 library CDN (marked, dompurify)
├── README.md
├── css/
│   ├── variables.css   # design tokens (custom properties)
│   ├── main.css        # reset, layout 2 kolom, responsive/drawer
│   └── components.css  # tombol, form, chat, modal, toast, dll
├── js/
│   ├── config.js       # konstanta: model, mode, level, storage keys
│   ├── storage.js      # wrapper localStorage aman (try/catch)
│   ├── api.js          # callGemini() + pemetaan error ke bahasa Indonesia
│   ├── prompt.js       # system prompt Socratic per mode & level
│   ├── chat.js         # render pesan, markdown, citation, efek typing
│   ├── math.js         # deteksi ruas LaTeX + muat KaTeX on-demand
│   ├── pdf.js          # ekstrak teks .pdf (pdf.js CDN, dimuat on-demand)
│   ├── docx.js         # ekstrak teks .docx (mammoth CDN, dimuat on-demand)
│   ├── sessions.js     # logika murni riwayat sesi: judul, urut, batas, migrasi
│   ├── ui.js           # modal, toast, onboarding, timer, statistik, ekspor
│   └── app.js          # entry point: state sesi + event binding
├── tests/
│   └── core.test.mjs   # unit test (node --test tests/core.test.mjs)
└── assets/
    └── favicon.svg     # kompas dalam gelembung chat
```

## Catatan teknis

- Vanilla JavaScript ES Modules; tanpa framework, tanpa build tool.
- CDN hanya 2 yang dimuat langsung (marked, DOMPurify); pdf.js dimuat on-demand hanya saat mengunggah `.pdf`, dan KaTeX dimuat on-demand hanya saat balasan berisi rumus.
- Layout: shell dikunci tinggi viewport (`overflow: hidden`) — yang bisa digulir hanya kotak chat. Sidebar riwayat 300px bisa diratakan di layar lebar; di layar ≤640px menjadi drawer. Panel setting berada di drawer kanan (fixed) yang sama di semua ukuran layar.
- API: Google Gemini `generateContent` (REST v1beta), dipanggil langsung dari browser.
- Riwayat percakapan (user + model) dikirim penuh pada setiap giliran; system prompt berisi materi siswa (lengkap, tanpa pemotongan) + pola **jelaskan-dulu-baru-tanyakan** — Socratic dipakai untuk mengecek pemahaman, bukan pengganti penjelasan; mode & level mengatur intensitas bimbingan.
- Riwayat sesi: `tanyabukan.sessions` (array, maks. 50, terlama terbuang) + `tanyabukan.activeSession`; tersimpan otomatis setiap giliran.
- File materi terlampir: tersimpan di dalam objek sesi (`session.files`) — **spesifik per sesi chat**, tidak global. Teksnya hanya ikut ke prompt model dan ekspor, tidak ditampilkan di panel Materi.
- Kutipan: system prompt mewajibkan AI membungkus frasa materi dengan `[[...]]`; frontend mengubahnya menjadi `<mark>` highlight + tooltip.
- Seluruh data tersimpan di `localStorage` dengan prefiks `tanyabukan.` — tombol **Hapus semua data** membersihkan hanya milik aplikasi ini.

## Pengujian

Unit test memakai test runner bawaan Node (tanpa dependensi):

```bash
node --test tests/core.test.mjs
```

Mencakup `mapApiError`, `extractSources`, bentuk permintaan `callGemini` (kunci di header, tanpa `temperature`, tool `google_search`), `fetchAvailableModels`, logika sesi, `extractMath`, `itemsToText`, `formatDuration`, dan prompt. Uji antarmuka (DOM) tetap manual — lihat `CHANGELOG.md`.

## Catatan perubahan

Rincian perbaikan, hal yang belum dikerjakan, dan yang perlu diuji manual ada di [`CHANGELOG.md`](./CHANGELOG.md).
