// tests/providers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, DEFAULT_PROVIDERS, listModels, resolveProviders, chatCompletion, probeEndpoint, providerChat } from '../js/providers.js';
import { extractSources } from '../js/api.js';

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  return calls;
}
const okRes = (json) => ({ ok: true, status: 200, json: async () => json });

// ---------- SSE streaming ----------
function sseRes(chunks) {
  const enc = new TextEncoder();
  return {
    ok: true, status: 200,
    body: new ReadableStream({
      start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
    }),
  };
}

test('chatCompletion: onDelta → stream SSE, token live, usage dari chunk', async () => {
  const deltas = [];
  const calls = stubFetch(() => sseRes([
    'data: {"choices":[{"delta":{"content":"Halo "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"siswa!"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\n',
    'data: [DONE]\n\n',
  ]));
  const r = await chatCompletion({
    provider: { baseUrl: 'http://x', chatPath: '/chat/completions' }, apiKey: '',
    model: 'm', contents: [{ role: 'user', text: 'hai' }],
    onDelta: (acc) => deltas.push(acc),
  });
  assert.deepEqual(deltas, ['Halo ', 'Halo siswa!']);   // akumulasi live
  assert.equal(r.text, 'Halo siswa!');
  assert.deepEqual(r.tokens, { prompt: 10, completion: 3, total: 13 });
  assert.equal(JSON.parse(calls[0].init.body).stream, true); // body minta stream
});

test('chatCompletion: tanpa onDelta → jalur non-stream biasa (tanpa body.stream)', async () => {
  const calls = stubFetch(() => okRes({ choices: [{ message: { content: 'Jawaban penuh.' } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
  const r = await chatCompletion({ provider: { baseUrl: 'http://x', chatPath: '/c' }, model: 'm', contents: [{ role: 'user', text: 'q' }] });
  assert.equal(r.text, 'Jawaban penuh.');
  assert.deepEqual(r.tokens, { prompt: 5, completion: 2, total: 7 });
  assert.ok(!JSON.parse(calls[0].init.body).stream);
});

// ---------- registry ----------
test('PROVIDERS: registry bawaan KOSONG (tanpa gemini hardcode)', () => {
  assert.deepEqual(PROVIDERS, {});
  assert.deepEqual(resolveProviders(), DEFAULT_PROVIDERS);
});

test('resolveProviders: gabung custom by id + flag custom', () => {
  const custom = [{ id: 'local', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234', modelsPath: '/models', chatPath: '/chat/completions' }];
  const all = resolveProviders(custom);
  assert.equal(all.local.name, 'LM Studio');
  assert.equal(all.local.custom, true);
  assert.equal(resolveProviders([{ id: 'x' }]).x, undefined); // tanpa baseUrl → ditolak
});

// ---------- probeEndpoint ----------
test('probeEndpoint: /models hidup → simpan path itu (kunci opsional → tanpa header)', async () => {
  const calls = stubFetch(() => okRes({ data: [] }));
  const r = await probeEndpoint('http://127.0.0.1:1234/');
  assert.deepEqual(r, { modelsPath: '/models', chatPath: '/chat/completions' });
  assert.equal(calls[0].url, 'http://127.0.0.1:1234/models');
  assert.deepEqual(calls[0].init.headers, {}); // tanpa kunci → tanpa header auth
});

test('probeEndpoint: fallback /v1/models saat /models gagal + Bearer bila berkunci', async () => {
  let n = 0;
  const calls = stubFetch(() => {
    n += 1;
    if (n === 1) return { ok: false, status: 404, json: async () => ({}) };
    return okRes({ data: [] });
  });
  const r = await probeEndpoint('http://127.0.0.1:1234', 'K');
  assert.deepEqual(r, { modelsPath: '/v1/models', chatPath: '/v1/chat/completions' });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer K');
});

test('probeEndpoint: 200 tapi body error → tolak path itu, lanjut kandidat berikutnya', async () => {
  // LM Studio menjawab GET /models dengan 200 + {"error": ...} →
  // path itu TIDAK boleh diterima hanya karena statusnya ok.
  let n = 0;
  const calls = stubFetch(() => {
    n += 1;
    if (n === 1) return okRes({ error: 'Unexpected endpoint or method. (GET /models)' });
    return okRes({ data: [{ id: 'qwen-max' }] });
  });
  const r = await probeEndpoint('http://127.0.0.1:1234');
  assert.deepEqual(r, { modelsPath: '/v1/models', chatPath: '/v1/chat/completions' });
  assert.equal(calls[0].url, 'http://127.0.0.1:1234/models');
  assert.equal(calls[1].url, 'http://127.0.0.1:1234/v1/models');
});

test('probeEndpoint: offline → error network; gagal keduanya → error ramah', async () => {
  stubFetch(() => { throw new Error('offline'); });
  await assert.rejects(() => probeEndpoint('http://127.0.0.1:1234'), (e) => e.type === 'network');
  let n = 0;
  stubFetch(() => { n += 1; return { ok: false, status: 404, json: async () => ({}) }; });
  await assert.rejects(() => probeEndpoint('http://x'), (e) => typeof e.message === 'string');
  await assert.rejects(() => probeEndpoint(''), (e) => e.type === 'badrequest');
});

test('probeEndpoint: fetch terblokir (CORS) → pesan menyebut CORS, bukan menyalahkan koneksi', async () => {
  // Browser melempar TypeError tanpa info saat respons diblokir CORS.
  stubFetch(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(() => probeEndpoint('http://127.0.0.1:1234'), (e) => {
    return e.type === 'network' && /CORS/i.test(e.message);
  });
});

// ---------- listModels ----------
const LOCAL = { id: 'local', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234', modelsPath: '/models', chatPath: '/chat/completions' };

test('listModels: GET ke modelsPath + filter chat-capable + dedup', async () => {
  const calls = stubFetch(() => okRes({ data: [
    { id: 'gpt-4o', owned_by: 'openai' },                       // tanpa capabilities → ikut
    { id: 'gpt-4o', capabilities: ['chat/completions'] },        // eksplisit chat → ikut (dedup)
    { id: 'text-embedding-003', owned_by: 'openai', capabilities: ['embedding'] }, // embedding saja → buang
    { id: 'qwen-max' },                                          // tanpa fields → ikut
  ] }));
  const ids = await listModels('K', LOCAL);
  assert.deepEqual(ids, ['gpt-4o', 'qwen-max']);
  assert.equal(calls[0].url, 'http://127.0.0.1:1234/models');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer K');
});

test('listModels: tanpa kunci → tanpa header auth; offline → network', async () => {
  const calls = stubFetch(() => okRes({ data: [{ id: 'm' }] }));
  await listModels('', LOCAL);
  assert.deepEqual(calls[0].init.headers, {});
  stubFetch(() => { throw new Error('offline'); });
  await assert.rejects(() => listModels('', LOCAL), (e) => e.type === 'network');
});

// ---------- chatCompletion ----------
test('chatCompletion: POST format [OI] + parse content & usage', async () => {
  const calls = stubFetch(() => okRes({
    choices: [{ message: { role: 'assistant', content: ' Halo dunia ' } }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  }));
  const r = await chatCompletion({
    provider: LOCAL, apiKey: 'K', model: 'qwen-max',
    systemPrompt: 'sys', contents: [{ role: 'user', text: 'hi' }],
  });
  assert.equal(r.text, 'Halo dunia');                       // content di-trim
  assert.deepEqual(r.tokens, { prompt: 12, completion: 8, total: 20 });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'qwen-max');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);
  assert.ok(calls[0].init.headers.Authorization === 'Bearer K');
});

test('chatCompletion: konteks digabung ke user pertama (tanpa role user berurutan)', async () => {
  const calls = stubFetch(() => okRes({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: {} }));
  await chatCompletion({
    provider: LOCAL, apiKey: 'K', model: 'm', systemPrompt: 'instruksi',
    contents: [
      { role: 'user', text: 'q1' },
      { role: 'model', text: 'a1' },
      { role: 'user', text: 'q2' },
    ],
    contextMessages: [
      { role: 'user', content: 'MATERI_A' },
      { role: 'user', content: 'MATERI_B' },
    ],
  });
  const body = JSON.parse(calls[0].init.body);
  // Konteks ditempel di depan pesan user pertama — tidak ada dua `user` berurutan
  // (sebagian model/endpoint menolak role berurutan dengan 400).
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'instruksi' },                    // instruksi tetap pertama
    { role: 'user', content: 'MATERI_A\n\nMATERI_B\n\nq1' },     // konteks + pertanyaan digabung
    { role: 'assistant', content: 'a1' },                        // riwayat model (role dimap)
    { role: 'user', content: 'q2' },
  ]);
  // Invariant: tak ada dua role sama berurutan.
  for (let i = 1; i < body.messages.length; i++) {
    assert.notEqual(body.messages[i].role, body.messages[i - 1].role, `role berurutan di indeks ${i}`);
  }
});

test('chatCompletion: konteks tanpa riwayat → tetap pesan terpisah setelah system', async () => {
  const calls = stubFetch(() => okRes({ choices: [{ message: { content: 'ok' } }], usage: {} }));
  await chatCompletion({
    provider: LOCAL, apiKey: 'K', model: 'm', systemPrompt: 'instruksi',
    contents: [],
    contextMessages: [{ role: 'user', content: 'MATERI_A' }],
  });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'instruksi' },
    { role: 'user', content: 'MATERI_A' },
  ]);
});

test('chatCompletion: kunci kosong → tanpa header; supportsThinking hanya bila provider mendukung', async () => {
  const calls = stubFetch(() => okRes({ choices: [{ message: { content: 'ok' } }], usage: {} }));
  await chatCompletion({ provider: LOCAL, apiKey: '', model: 'm', systemPrompt: 's', contents: [{ role: 'user', text: 'x' }], thinkingLevel: 'low' });
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' }); // tanpa Authorization
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.generationConfig, undefined); // supportsThinking false
});

test('chatCompletion: grounding → tools bila didukung; graceful degradation 400 → retry tanpa tools', async () => {
  let n = 0;
  globalThis.fetch = async (url, init) => {
    n += 1;
    const body = JSON.parse(init.body);
    if (n === 1 && body.tools) return { ok: false, status: 400, json: async () => ({ error: { message: 'tools not supported' } }) };
    if (n === 2 && !body.tools) return okRes({ choices: [{ message: { content: 'tanpa-tools' } }], usage: { total_tokens: 3 } });
    return okRes({ choices: [{ message: { content: 'x' } }], usage: { total_tokens: 1 } });
  };
  const supp = { ...LOCAL, supportsGrounding: true };
  const r = await chatCompletion({
    provider: supp, apiKey: 'K', model: 'm', systemPrompt: 's',
    contents: [{ role: 'user', text: 'x' }], grounding: true,
  });
  assert.equal(r.text, 'tanpa-tools');   // retry tanpa tools menghasilkan jawaban
  assert.equal(n, 2);                    // benar-benar 2 panggilan (tools → tanpa tools)
});

test('chatCompletion: kascade 400 — tools → stream_options → max_tokens dilucuti bertahap', async () => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    if (b.tools) return { ok: false, status: 400, json: async () => ({ error: { message: 'tools not supported' } }) };
    if (b.stream_options) return { ok: false, status: 400, json: async () => ({ error: { message: 'stream_options unsupported' } }) };
    if (b.max_tokens === 8192) return { ok: false, status: 400, json: async () => ({ error: { message: 'max_tokens too large' } }) };
    return okRes({ choices: [{ message: { content: 'akhirnya' } }], usage: { total_tokens: 2 } });
  };
  const r = await chatCompletion({
    provider: { ...LOCAL, supportsGrounding: true }, apiKey: 'K', model: 'm', systemPrompt: 's',
    contents: [{ role: 'user', text: 'x' }], grounding: true,
    onDelta: (acc) => {}, // minta stream + stream_options
  });
  assert.equal(r.text, 'akhirnya');
  assert.equal(bodies.length, 4); // tools → stream_options → max_tokens 8192 → sukses
  assert.equal(bodies[1].tools, undefined);
  assert.equal(bodies[2].stream_options, undefined);
  assert.equal(bodies[3].max_tokens, 2048);
  assert.equal(bodies[3].stream, true); // stream TIDAK dilepas di tahap-tahap ini
});

test('chatCompletion: 413 → kascade sampai stream dilepas; respons JSON diparse normal', async () => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    if (b.stream) return { ok: false, status: 413, json: async () => ({ error: { message: 'request entity too large' } }) };
    return okRes({ choices: [{ message: { content: 'non-stream sukses' } }], usage: { total_tokens: 1 } });
  };
  const r = await chatCompletion({
    provider: LOCAL, apiKey: 'K', model: 'm', systemPrompt: 's',
    contents: [{ role: 'user', text: 'x' }],
    onDelta: () => {}, // awalnya minta stream
  });
  assert.equal(r.text, 'non-stream sukses');
  const last = bodies[bodies.length - 1];
  assert.equal(last.stream, undefined);     // stream dilepas di tahap 413
  assert.equal(last.max_tokens, undefined); // max_tokens ikut dilucuti lebih dulu
});

test('chatCompletion: 400 model strict tetap gagal dengan pesan kompatibilitas setelah kascade habis', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'invalid request' } }) });
  await assert.rejects(
    () => chatCompletion({ provider: LOCAL, apiKey: 'K', model: 'm', systemPrompt: 's', contents: [{ role: 'user', text: 'x' }] }),
    (e) => e.type === 'badrequest' && /kompatibel/.test(e.message),
  );
});

test('chatCompletion: sources dari groundingMetadata bila ada', async () => {  globalThis.fetch = async () => okRes({
    choices: [{ message: { content: 'jawaban' } }],
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://a.id', title: 'A' } }] } }],
  });
  const r = await chatCompletion({ provider: LOCAL, apiKey: 'K', model: 'm', systemPrompt: 's', contents: [{ role: 'user', text: 'x' }] });
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].url, 'https://a.id');
});

test('chatCompletion & providerChat: tanpa provider → error ramah (tanpa fallback diam)', async () => {
  stubFetch(() => okRes({ choices: [{ message: { content: 'x' } }] }));
  await assert.rejects(() => chatCompletion({ model: 'm' }), (e) => e.type === 'badrequest');
  await assert.rejects(() => providerChat('tidak-ada', { customProviders: [], model: 'm' }), (e) => e.type === 'badrequest');
  // provider dikenal → jalan
  const r = await providerChat('local', { customProviders: [LOCAL], apiKey: '', model: 'm', systemPrompt: 's', contents: [{ role: 'user', text: 'x' }] });
  assert.equal(r.text, 'x');
});

// ---------- extractSources (tetap dipakai provider.js) ----------
test('extractSources: kosong aman', () => {
  assert.deepEqual(extractSources(undefined), []);
  assert.deepEqual(extractSources({}), []);
});
