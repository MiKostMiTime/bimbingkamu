// =========================================================
// UJI: MATERI DARI URL
// ------------------------------------------------------------
// Lampiran materi boleh berupa halaman website: /api/fetch mengambil HTML,
// membersihkannya jadi teks, lalu klien menyimpannya sebagai file materi sesi.
// Jalankan: node --test tests/url-material.test.js
// =========================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReadableText, decodeEntities } from '../functions/api/fetch.js';
import { normalizeQuery, normalizeResults } from '../functions/api/search.js';
import { fetchUrlMaterial } from '../js/url-material.js';

test('decodeEntities menangani named + numeric entity', () => {
  assert.equal(decodeEntities('A &amp; B &lt;c&gt; &#65; &#x42;'), 'A & B <c> A B');
});

test('extractReadableText membuang skrip/nav dan mempertahankan isi utama', () => {
  const html = `<!doctype html><html><head><title>Fotosintesis &amp; Klorofil</title>
    <style>.x{color:red}</style></head>
    <body><nav>Beranda | Tentang</nav>
    <main><h1>Fotosintesis</h1><p>Tumbuhan mengubah cahaya menjadi energi.</p>
    <script>alert('halo')</script></main>
    <footer>Hak cipta</footer></body></html>`;
  const page = extractReadableText(html);
  assert.equal(page.title, 'Fotosintesis & Klorofil');
  assert.match(page.text, /Tumbuhan mengubah cahaya/);
  assert.doesNotMatch(page.text, /alert/);
  assert.doesNotMatch(page.text, /Beranda/);
  assert.doesNotMatch(page.text, /Hak cipta/);
  assert.equal(page.truncated, false);
});

test('extractReadableText memotong teks melebihi batas', () => {
  const html = `<article><p>${'kata '.repeat(50)}</p></article>`;
  const page = extractReadableText(html, { maxChars: 40 });
  assert.equal(page.truncated, true);
  assert.ok(page.text.length <= 40);
});

test('normalizeQuery merapikan spasi dan memotong kueri panjang', () => {
  assert.equal(normalizeQuery('  hukum   newton  '), 'hukum newton');
  assert.equal(normalizeQuery(null), '');
  assert.equal(normalizeQuery('x'.repeat(400)).length, 300);
});

test('normalizeResults server: hanya http(s), dedup, batas hasil', () => {
  const out = normalizeResults([
    { url: 'https://a.example/x', title: 'A', content: 'a' },
    { url: 'https://a.example/x#y', title: 'dup' },
    { url: 'javascript:alert(1)', title: 'jahat' },
    { url: 'https://b.example/y', title: 'B', published_date: '2024-05-01T00:00:00Z' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1].publishedDate, '2024-05-01');
});

test('fetchUrlMaterial mengubah halaman menjadi teks materi', async () => {
  const original = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async (url) => {
    requested = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        url: 'https://contoh.example/artikel',
        title: 'Artikel Contoh',
        text: 'Isi halaman yang bisa dibaca.',
        truncated: false,
      }),
    };
  };
  try {
    const page = await fetchUrlMaterial('https://contoh.example/artikel');
    assert.equal(requested, '/api/fetch?url=https%3A%2F%2Fcontoh.example%2Fartikel');
    assert.equal(page.title, 'Artikel Contoh');
    assert.equal(page.text, 'Isi halaman yang bisa dibaca.');
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchUrlMaterial menolak alamat non-http tanpa memanggil jaringan', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; };
  try {
    await assert.rejects(
      () => fetchUrlMaterial('contoh.example'),
      (err) => err.type === 'badrequest' && /http/i.test(err.message),
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchUrlMaterial memetakan error server menjadi pesan ramah', async () => {
  const original = globalThis.fetch;
  const reply = (status, error) => async () => ({
    ok: false,
    status,
    json: async () => ({ ok: false, error }),
  });
  try {
    globalThis.fetch = reply(403, 'forbidden');
    await assert.rejects(
      () => fetchUrlMaterial('https://localhost/rahasia'),
      (err) => err.type === 'badrequest' && /alamat lokal\/privat/i.test(err.message),
    );

    globalThis.fetch = reply(415, 'not-html');
    await assert.rejects(
      () => fetchUrlMaterial('https://contoh.example/gambar.png'),
      (err) => err.type === 'badrequest' && /bukan halaman web/i.test(err.message),
    );

    globalThis.fetch = reply(422, 'empty');
    await assert.rejects(
      () => fetchUrlMaterial('https://contoh.example/spa'),
      (err) => err.type === 'badrequest' && /JavaScript/i.test(err.message),
    );

    globalThis.fetch = reply(413, 'too-large');
    await assert.rejects(
      () => fetchUrlMaterial('https://contoh.example/raksasa'),
      (err) => err.type === 'badrequest' && /terlalu besar/i.test(err.message),
    );
  } finally {
    globalThis.fetch = original;
  }
});
