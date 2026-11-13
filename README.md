# BimbingKamu

Tutor belajar Socratic berbasis RAG untuk siswa. Alih-alih langsung menjawab, BimbingKamu membimbingmu menemukan jawaban **dari materi milikmu sendiri** lebih dalam dan lebih fokus, dengan halusinasi yang ditekan lewat batasan prompt dan penandaan kutipan yang tidak ditemukan di materi (bukan jaminan mutlak).

Proyek ini memakai skema **BYOK** (Bring Your Own Key): kamu memasukkan kunci API *provider* milikmu seperti OpenRouter, Gemini AI Studio, Anthropic, Groq, atau OpenAI (dan endpoint lain yang kompatibel dengan OpenAI). Kunci hanya tersimpan di `localStorage` browser dan hanya dikirim ke endpoint yang kamu pilih; tidak ada backend, tidak ada server, tidak ada pelacakan.

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

Kunci API bersifat **opsional** — endpoint lokal (mis. LM Studio/Ollama) biasanya tidak butuh kunci. Untuk provider cloud, ambil kunci lalu tempel di panel **Kunci API**:

- **OpenRouter** → [openrouter.ai/api/keys](https://openrouter.ai/api/keys).
- **Gemini AI Studio** → [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) (login Google, klik **Create API key**).
- **OpenAI** → [platform.openai.com/api/keys](https://platform.openai.com/api/keys).
- **Anthropic** → [console.anthropic.com/settings/keys](console.anthropic.com/settings/keys).
- **Groq** → [console.groq.com/keys](console.groq.com/keys).

Bila belum punya endpoint, pilih salah satu provider bawaan di panel **Endpoint & Model**, lalu tempel kuncinya. Lima provider langsung tersedia saat pertama kali (**OpenRouter**, **Gemini AI Studio**, **OpenAI**, **Anthropic, dan Groq**); hubungkan endpoint sendiri bila mau. Kuota gratis tersedia tiap provider; jika habis, coba lagi keesokan hari atau ganti provider.

> **Penting untuk siswa SMA:** periksa syarat penggunaan masing-masing provider (termasuk batas usia akun dan penggunaan data pada paket gratis). Jika siswa di bawah usia yang disyaratkan, guru atau orang tua sebaiknya menyediakan kunci.


## Daftar fitur

- **BYOK (Bring Your Own Key)** — Masukkan kunci API *provider* (opsional; endpoint lokal tak butuh) dengan toggle lihat/sembunyikan, tersimpan otomatis di `localStorage`, indikator privasi, dan tombol hapus semua data.
- **Materi (Retrieval-Augmented Generation)** — **Lampirkan file** `.txt`/`.md`/`.pdf`/`.docx` (drag & drop atau klik; teks PDF diekstrak via pdf.js, .docx via mammoth — semua di browser) **atau tempel alamat website** yang isinya dibaca server lalu disimpan sebagai teks materi. File tampil sebagai **chip** (nama + jumlah karakter + tombol lepas) — teks hasil ekstraksi **tidak ditampilkan** di panel, tapi tetap ikut dikirim ke model. File **spesifik per sesi chat** (tiap chat punya lampirannya sendiri). Penghitung karakter real-time, tersimpan antar sesi.
- **Pengaturan belajar** — 4 mode (Paham Konsep, **Penjelasan** — penjelasan tuntas tanpa interogasi, Latihan Soal, Persiapan Ujian), slider kedalaman bimbingan 1–5 (mengubah aturan prompt; parameter temperature tidak dipakai lagi karena sudah deprecated di banyak model, diganti `thinkingLevel` per mode), **gaya bahasa** Santai ↔ Formal (menyesuaikan derajat keakraban bahasa tanpa mengubah metode Socratic), dan pilihan model — daftarnya **disegarkan otomatis dari endpoint terpilih**, jadi model yang sudah dinonaktifkan provider tidak lagi ditawarkan (bebas error 404). Provider dipilih dari dropdown; lima bawaan langsung tersedia (**OpenRouter**, **Gemini AI Studio**, **OpenAI**, **Anthropic, dan Groq**), atau hubungkan endpoint [OI]-compatible sendiri.
- **Cari web** — Toggle "Cari web untuk pelengkap" memakai alat `web_search` sungguhan di balik `/api/search` (Tavily, 5 hasil, satu putaran). Kunci Tavily hanya ada di server. Toggle otomatis mati bila server belum dikonfigurasi atau layanan tidak bisa memanggil alat, dan tutor dilarang mengaku mencari. Sumber tampil **bernomor** (cocok dengan penanda `[1]` di jawaban) beserta **tanggal akses**, plus tombol **＋ Simpan ke materi**. Bila model memilih tidak mencari, jawaban diberi label jujur "Dari pengetahuan model".
- **Riwayat sesi** — Sidebar kiri menampilkan semua sesi (judul otomatis dari pertanyaanmu + tanggal relatif, maks. 50); klik untuk membuka kembali, hapus per sesi, auto-save tiap giliran, migrasi otomatis dari format versi lama.
- **Percakapan** — Multi-turn, render markdown + sanitasi, **rumus LaTeX tampil sebagai rumus visual via KaTeX** (dimuat on-demand; offline tetap terbaca sebagai teks mentah), kutipan materi `[[...]]` disorot sebagai chip (yang tidak ditemukan di materi diberi tanda *belum terverifikasi*), efek mengetik progresif dengan tombol Lewati, sapaan pembuka otomatis.
- **Data & statistik** — Timer waktu aktif (berhenti saat idle/tab tersembunyi), penghitung petunjuk, penghitung giliran dialog, ekspor percakapan ke file `.md` (bagian dari eksperimen STEM), **dan ekspor kartu studi ke gambar `.png`** (shareable untuk WA/IG) lewat menu titik-tiga di tiap sesi.
- **Prompt starters** — Contoh pertanyaan (🧪 Uji pemahaman, 📖 Jelasin bab ini, ✍️ Ringkasan, 📝 Latihan + kunci, 💬 Lainnya) siap ketok di atas kotak chat; ketok sekali otomatis mengisi dan bisa diedat atau langsung dikirim.
- **Pengalaman** — Onboarding 3 langkah, empty state, toast, error ramah per jenis (kunci salah / kuota habis / model tak tersedia / server sibuk / jaringan), semua panel setting (kunci API, materi, mode/level/model) terpusat di **drawer kanan** yang dibuka tombol gear — trigger & panel sepihak, kunci tidak tergeletak di layar utama; sidebar riwayat bisa diratakan di layar lebar (drawer di HP ≤640px); halaman terkunci sehingga hanya kotak chat yang digulir — seperti aplikasi chat, aksesibilitas keyboard + focus state + kontras AA.

## Struktur folder

```
bimbingkamu/
├── index.html          # markup, muat CSS + 2 library CDN (marked, dompurify)
├── README.md
├── css/
│   ├── variables.css   # design tokens (custom properties)
│   ├── main.css        # reset, layout 2 kolom, responsive/drawer
│   └── components.css  # tombol, form, chat, modal, toast, dll
├── js/
│   ├── config.js       # konstanta: model, mode, level, storage keys
│   ├── storage.js      # wrapper localStorage aman (try/catch)
│   ├── api.js          # pemetaan error + ekstraksi sumber ke bahasa Indonesia
│   ├── providers.js    # registry endpoint [OI]-generic + dynamic pricing + listModels
│   ├── prompt.js       # system prompt Socratic per mode, level & gaya bahasa
│   ├── chat.js         # render pesan, markdown, citation, efek typing
│   ├── math.js         # deteksi ruas LaTeX + muat KaTeX on-demand
│   ├── pdf.js          # ekstrak teks .pdf (pdf.js CDN, dimuat on-demand)
│   ├── docx.js         # ekstrak teks .docx (mammoth CDN, dimuat on-demand)
│   ├── card.js         # ekspor kartu studi ke PNG (html2canvas, dimuat on-demand)
│   ├── sessions.js     # logika murni riwayat sesi: judul, urut, batas, migrasi
│   ├── ui.js           # modal, toast, onboarding, timer, statistik, ekspor
│   └── app.js          # entry point: state sesi + event binding
├── tests/
│   └── core.test.mjs   # unit test (node --test tests/*.mjs)
└── assets/
    └── favicon.svg     # kompas dalam gelembung chat
```

## Catatan teknis

- Vanilla JavaScript ES Modules; tanpa framework, tanpa build tool.
- Layout: shell dikunci tinggi viewport (`overflow: hidden`) — yang bisa digulir hanya kotak chat. Sidebar riwayat 300px bisa diratakan di layar lebar; di layar ≤640px menjadi drawer. Panel setting berada di drawer kanan (fixed) yang sama di semua ukuran layar.
- API: generik **[OI]-compatible** — tiap endpoint dihubunkan lewat path `/models` + `/chat/completions`; header auth & tools (grounding) disesuaikan per provider. Harga model **dinamis**: OpenRouter diambil live dari endpoint, LM Studio lokal = gratis, lainnya ditampilkan tanpa biaya.
- Riwayat percakapan (user + model) dikirim penuh pada setiap giliran; system prompt berisi materi siswa (lengkap, tanpa pemotongan) + pola **jelaskan-dulu-baru-tanyakan** — Socratic dipakai untuk mengecek pemahaman, bukan pengganti penjelasan; mode & level mengatur intensitas bimbingan.
- Riwayat sesi: `bimbingkamu.sessions` (array, maks. 50, terlama terbuang) + `bimbingkamu.activeSession`; tersimpan otomatis setiap giliran.
- File materi terlampir: tersimpan di dalam objek sesi (`session.files`) — **spesifik per sesi chat**, tidak global. Teksnya hanya ikut ke prompt model dan ekspor, tidak ditampilkan di panel Materi.
- Kutipan: system prompt mewajibkan AI membungkus frasa materi dengan `[[...]]`; frontend mengubahnya menjadi `<mark>` highlight + tooltip.
- Seluruh data tersimpan di `localStorage` dengan prefiks `bimbingkamu.` — tombol **Hapus semua data** membersihkan hanya milik aplikasi ini.

