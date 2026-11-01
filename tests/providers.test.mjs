// tests/providers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, listModels, resolveProviders } from '../js/providers.js';

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
