// Uji perbaikan websearch: extractSources multi-shape + tangkap sumber di
// jalur streaming (SSE) & non-stream. Jalankan: node --test tests/websearch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSources } from '../js/api.js';
import { chatCompletion } from '../js/providers.js';

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  return calls;
}
const okRes = (json) => ({ ok: true, status: 200, json: async () => json });
function sseRes(chunks) {
  const enc = new TextEncoder();
  return {
    ok: true, status: 200,
    body: new ReadableStream({
      start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
    }),
  };
}

// ---------- extractSources: multi-shape ----------
test('extractSources: OpenAI-compatible citations ({uri,title})', () => {
  const out = extractSources({ citations: [{ uri: 'https://id.wikipedia.org/x', title: 'Wiki' }] });
  assert.deepEqual(out, [{ url: 'https://id.wikipedia.org/x', title: 'Wiki', snippet: '' }]);
});

test('extractSources: grounding_metadata bersarang (OpenAI-Gemini)', () => {
  const out = extractSources({
    grounding_metadata: { groundingChunks: [{ web: { uri: 'https://k.id/y', title: 'K' } }] },
  });
  assert.equal(out[0].url, 'https://k.id/y');
  assert.equal(out[0].title, 'K');
});

test('extractSources: tool_calls generic (args JSON + metadata)', () => {
  const out = extractSources({
    tool_calls: [
      { args: JSON.stringify({ url: 'https://a.id', title: 'A' }) },
      { metadata: { uri: 'https://b.id', title: 'B' } },
    ],
  });
  assert.deepEqual(out.map((s) => s.url), ['https://a.id', 'https://b.id']);
});

test('extractSources: dedup, maks 6, hanya http(s)', () => {
  const citations = [];
  for (let i = 0; i < 8; i += 1) citations.push({ uri: `https://s.id/${i}`, title: `S${i}` });
  citations.push({ uri: 'ftp://bad/x', title: 'Ftp' }); // non-http → dilewati
  citations.push({ uri: 'https://s.id/0', title: 'dup' }); // duplikat URL → dilewati
  const out = extractSources({ citations });
  assert.equal(out.length, 6);
  assert.deepEqual(out[0], { url: 'https://s.id/0', title: 'S0', snippet: '' });
  assert.ok(!out.some((s) => s.url.startsWith('ftp://')));
});

test('extractSources: kosong aman (backward compat)', () => {
  assert.deepEqual(extractSources(undefined), []);
  assert.deepEqual(extractSources({}), []);
});

// ---------- tangkap sumber di jalur streaming (SSE) ----------
test('chatCompletion streaming: tangkap citations dari chunk SSE', async () => {
  stubFetch(() => sseRes([
    'data: {"choices":[{"delta":{"content":"Jawaban"}}],"citations":[{"uri":"https://cred.id/x","title":"Kredibel"}]}\n\n',
    'data: [DONE]\n\n',
  ]));
  const r = await chatCompletion({
    provider: { baseUrl: 'http://x', chatPath: '/chat/completions' }, apiKey: '',
    model: 'm', contents: [{ role: 'user', text: 'q' }], grounding: true, onDelta: () => {},
  });
  assert.deepEqual(r.sources, [{ url: 'https://cred.id/x', title: 'Kredibel', snippet: '' }]);
});

test('chatCompletion streaming: tangkap groundingMetadata native di dalam choice', async () => {
  stubFetch(() => sseRes([
    'data: {"choices":[{"delta":{"content":"An"},"groundingMetadata":{"groundingChunks":[{"web":{"uri":"https://n.id","title":"N"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ]));
  const r = await chatCompletion({
    provider: { baseUrl: 'http://x', chatPath: '/chat/completions' }, apiKey: '',
    model: 'm', contents: [{ role: 'user', text: 'q' }], grounding: true, onDelta: () => {},
  });
  assert.deepEqual(r.sources, [{ url: 'https://n.id', title: 'N', snippet: '' }]);
});

// ---------- tangkap sumber di jalur non-stream ----------
test('chatCompletion non-stream: citations di top-level body (OpenAI-compatible)', async () => {
  stubFetch(() => okRes({
    choices: [{ message: { content: 'Jawaban.' } }],
    citations: [{ uri: 'https://o.id/z', title: 'OpenAI' }],
  }));
  const r = await chatCompletion({
    provider: { baseUrl: 'http://x', chatPath: '/c' }, apiKey: '',
    model: 'm', contents: [{ role: 'user', text: 'q' }], grounding: true,
  });
  assert.deepEqual(r.sources, [{ url: 'https://o.id/z', title: 'OpenAI', snippet: '' }]);
});

test('chatCompletion non-stream: native candidates[].groundingMetadata (backward compat)', async () => {
  stubFetch(() => okRes({
    choices: [{ message: { content: 'Jawaban.' } }],
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://c.id', title: 'C' } }] } }],
  }));
  const r = await chatCompletion({
    provider: { baseUrl: 'http://x', chatPath: '/c' }, apiKey: '',
    model: 'm', contents: [{ role: 'user', text: 'q' }], grounding: true,
  });
  assert.deepEqual(r.sources, [{ url: 'https://c.id', title: 'C', snippet: '' }]);
});
