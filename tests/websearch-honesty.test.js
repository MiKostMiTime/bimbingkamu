// =========================================================
// UJI: KEJUJURAN PENCARIAN WEB
// ------------------------------------------------------------
// Fokus: tutor tidak boleh mengaku mencari saat alat tidak tersedia,
// dan state UI harus membedakan "tak didukung", "dari pengetahuan model",
// "dicari tapi kosong", serta "punya sumber".
//
// Jalankan: node --test tests/websearch-honesty.test.js
// =========================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildMaterialMessage } from '../js/prompt.js';
import { classifyWebSearch } from '../js/api.js';
import { webSearchStatusText } from '../js/chat.js';
import {
  buildSearchTool,
  buildAnthropicSearchTool,
  normalizeSearchResults,
  searchWeb,
  clearSearchCache,
} from '../js/search.js';

const basePrompt = {
  materi: 'Air mendidih pada 100 derajat Celsius di tekanan 1 atm.',
  mode: 'konsep',
  level: 3,
  tone: 'santai',
};

test('prompt webSearch=false: menyatakan TIDAK punya akses internet', () => {
  const prompt = buildSystemPrompt({ ...basePrompt, webSearch: false });
  assert.match(prompt, /TIDAK punya akses internet/i);
  assert.match(prompt, /jangan pernah bilang sudah mencari/i);
  assert.doesNotMatch(prompt, /Google Search/);
  assert.doesNotMatch(prompt, /web_search/);
});

test('prompt webSearch=true: menyebut alat web_search + aturan sitasi bernomor', () => {
  const prompt = buildSystemPrompt({ ...basePrompt, webSearch: true });
  assert.match(prompt, /web_search/);
  assert.match(prompt, /\[1\]/);
  assert.match(prompt, /\(tanpa tanggal\)/);
  assert.match(prompt, /Ringkasan 3 poin/);
  assert.doesNotMatch(prompt, /Google Search/);
});

test('blok materi tidak lagi menjanjikan "Google Search tersedia"', () => {
  const msg = buildMaterialMessage('Materi contoh.', true);
  assert.doesNotMatch(msg.content, /Google Search/);
  assert.match(msg.content, /Pencarian web hanya pelengkap/);
});

test('classifyWebSearch memetakan setiap keadaan dengan jujur', () => {
  const sources = [{ url: 'https://example.com', title: 'Contoh' }];
  assert.equal(classifyWebSearch({ webSearch: false, supportsGrounding: true, sources }), 'off');
  assert.equal(classifyWebSearch({ webSearch: true, supportsGrounding: false }), 'unsupported');
  assert.equal(classifyWebSearch({ webSearch: true, supportsGrounding: true, sources: [] }), 'model-only');
  assert.equal(
    classifyWebSearch({ webSearch: true, supportsGrounding: true, sources: [], search: { supported: true, ran: true } }),
    'searched-empty',
  );
  assert.equal(
    classifyWebSearch({ webSearch: true, supportsGrounding: true, sources, search: { supported: true, ran: true } }),
    'ok',
  );
  // Metadata `search` menang atas field lama yang mungkin basi.
  assert.equal(
    classifyWebSearch({ webSearch: true, supportsGrounding: true, sources: [], search: { supported: false } }),
    'unsupported',
  );
});

test('label status: "off" dan "ok" tidak menampilkan klaim apa pun', () => {
  assert.equal(webSearchStatusText('off'), '');
  assert.equal(webSearchStatusText('ok'), '');
  assert.match(webSearchStatusText('model-only'), /Dari pengetahuan model/);
  assert.match(webSearchStatusText('searched-empty'), /tidak menemukan sumber/);
  assert.match(webSearchStatusText('unsupported'), /tidak bisa mencari/);
});

test('deklarasi alat OpenAI-compatible punya skema parameters', () => {
  const tool = buildSearchTool();
  assert.equal(tool.type, 'function');
  assert.equal(tool.function.name, 'web_search');
  assert.deepEqual(tool.function.parameters.required, ['query']);
  assert.equal(tool.function.parameters.type, 'object');
});

test('deklarasi alat Claude memakai input_schema (tanpa type:function)', () => {
  const tool = buildAnthropicSearchTool();
  assert.equal(tool.name, 'web_search');
  assert.equal(tool.input_schema.type, 'object');
  assert.equal(tool.type, undefined);
});

test('normalizeSearchResults: hanya http(s), dedup, maks 5, snippet dipangkas', () => {
  const raw = [
    { url: 'https://a.example/1', title: 'A', content: 'isi a' },
    { url: 'https://a.example/1#bagian', title: 'Duplikat', content: 'x' },
    { url: 'ftp://b.example/file', title: 'Bukan web' },
    { url: 'https://b.example/2', title: 'B', content: 'b'.repeat(900) },
    { url: 'https://c.example/3', title: 'C' },
    { url: 'https://d.example/4', title: 'D' },
    { url: 'https://e.example/5', title: 'E' },
    { url: 'https://f.example/6', title: 'F' },
  ];
  const out = normalizeSearchResults(raw);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((r) => r.url), [
    'https://a.example/1',
    'https://b.example/2',
    'https://c.example/3',
    'https://d.example/4',
    'https://e.example/5',
  ]);
  assert.equal(out[1].snippet.length, 500);
});

test('searchWeb memanggil /api/search dan memakai cache untuk kueri sama', async () => {
  clearSearchCache();
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(url, '/api/search');
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).query, 'hukum newton');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [{ url: 'https://fisika.example/newton', title: 'Hukum Newton', content: 'F = m a' }],
      }),
    };
  };
  const first = await searchWeb('hukum newton', { fetchImpl });
  assert.equal(first.cached, false);
  assert.equal(first.results.length, 1);
  const second = await searchWeb('hukum  newton', { fetchImpl });
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test('searchWeb memetakan error server menjadi pesan ramah', async () => {
  clearSearchCache();
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ ok: false, error: 'search-not-configured' }),
  });
  await assert.rejects(
    () => searchWeb('kueri unik 1', { fetchImpl }),
    (err) => err.type === 'search' && /belum diaktifkan/i.test(err.message),
  );
});
