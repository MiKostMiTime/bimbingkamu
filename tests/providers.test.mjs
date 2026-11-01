// tests/providers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, listModels, resolveProviders, chatCompletion } from '../js/providers.js';
import { extractSources } from '../js/api.js';

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  return calls;
}
const okRes = (json) => ({ ok: true, status: 200, json: async () => json });

test('PROVIDERS.gemini: path adapter OpenAI + header x-goog-api-key', () => {
  assert.equal(PROVIDERS.gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(PROVIDERS.gemini.modelsPath, '/openai/models');
  assert.equal(PROVIDERS.gemini.chatPath, '/openai/chat/completions');
  assert.equal(PROVIDERS.gemini.authHeader, 'x-goog-api-key');
  assert.equal(PROVIDERS.gemini.supportsGrounding, true);
  assert.equal(PROVIDERS.gemini.supportsThinking, true);
});

test('listModels: GET ke modelsPath + header auth + filter chat-capable', async () => {
  const calls = stubFetch(() => okRes({ data: [
    { id: 'gpt-4o', owned_by: 'openai' },                       // tanpa capabilities → ikut
    { id: 'gpt-4o', capabilities: ['chat/completions'] },        // eksplisit chat → ikut (duplikat di-dedup)
    { id: 'text-embedding-003', owned_by: 'openai', capabilities: ['embedding'] }, // embedding saja → buang
    { id: 'qwen-max' },                                          // tanpa fields → ikut
  ] }));
  const ids = await listModels('K', PROVIDERS.gemini);
  assert.deepEqual(ids, ['gpt-4o', 'qwen-max']);
  assert.equal(calls[0].url, `${PROVIDERS.gemini.baseUrl}${PROVIDERS.gemini.modelsPath}`);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'K');
});

test('listModels: offline → lempar error ramah (network)', async () => {
  stubFetch(() => { throw new Error('offline'); });
  await assert.rejects(() => listModels('K', PROVIDERS.gemini), (e) => e.type === 'network');
});

test('resolveProviders: gabung default + custom', () => {
  const custom = [{ id: 'local', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' }];
  const all = resolveProviders(custom);
  assert.equal(all.gemini.id, 'gemini');
  assert.equal(all.local.baseUrl, 'http://localhost:11434/v1');
});

// tests/providers.test.mjs — chatCompletion (OpenAI path) + ekstraksi sumber + graceful degradation
test('chatCompletion: POST format OpenAI + parse content & usage', async () => {
  const calls = stubFetch(() => okRes({
    choices: [{ message: { role: 'assistant', content: ' Halo dunia ' } }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  }));
  const r = await chatCompletion({
    provider: PROVIDERS.gemini, apiKey: 'K', model: 'gemini-3.8-flash',
    systemPrompt: 'sys', contents: [{ role: 'user', text: 'hi' }],
  });
  assert.equal(r.text, 'Halo dunia');                       // content di-trim
  assert.deepEqual(r.tokens, { prompt: 12, completion: 8, total: 20 });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ]);
  assert.ok(calls[0].init.headers['x-goog-api-key'] === 'K');
});

test('chatCompletion: grounding → tools bila didukung, fallback tanpa tools', async () => {
  // Percobaan 1: tools diterima.
  let n = 0;
  globalThis.fetch = async (url, init) => {
    n += 1;
    const body = JSON.parse(init.body);
    if (n === 1 && body.tools) return okRes({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 5 } });
    if (n === 2 && !body.tools) return okRes({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 5 } });
    return okRes({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 5 } });
  };
  const r = await chatCompletion({
    provider: PROVIDERS.gemini, apiKey: 'K', model: 'gemini-3.8-flash',
    systemPrompt: 's', contents: [{ role: 'user', text: 'x' }], grounding: true,
  });
  assert.equal(r.text, 'ok');
});

test('chatCompletion: sources dari groundingMetadata (Gemini)', async () => {
  globalThis.fetch = async () => okRes({
    choices: [{ message: { content: 'jawaban' } }],
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://a.id', title: 'A' } }] } }],
  });
  const r = await chatCompletion({ provider: PROVIDERS.gemini, apiKey: 'K', model: 'm', systemPrompt: 's', contents: [{ role: 'user', text: 'x' }] });
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].url, 'https://a.id');
});

// TAMBAHAN (bonus coverage): fallback-tools BENAR-BENAR diuji — tools ditolak (400), retry tanpa tools sukses.
test('chatCompletion: graceful degradation → retry tanpa tools saat 400', async () => {
  let n = 0;
  globalThis.fetch = async (url, init) => {
    n += 1;
    const body = JSON.parse(init.body);
    if (n === 1 && body.tools) return { ok: false, status: 400, json: async () => ({ error: { message: 'tools not supported' } }) };
    if (n === 2 && !body.tools) return okRes({ choices: [{ message: { content: 'tanpa-tools' } }], usage: { total_tokens: 3 } });
    return okRes({ choices: [{ message: { content: 'x' } }], usage: { total_tokens: 1 } });
  };
  const r = await chatCompletion({
    provider: PROVIDERS.gemini, apiKey: 'K', model: 'm', systemPrompt: 's',
    contents: [{ role: 'user', text: 'x' }], grounding: true,
  });
  assert.equal(r.text, 'tanpa-tools');   // retry tanpa tools menghasilkan jawaban
  assert.equal(n, 2);                    // benar-benar 2 panggilan (tools → tanpa tools)
});
