// Jalankan: node --test tests/metadata.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, syncSession } from '../js/sessions.js';

test('syncSession: menyimpan field metadata token & biaya', () => {
  const s = createSession(1);
  const msgs = [
    { role: 'user', text: 'hai' },
    { role: 'model', text: 'halo', tokens: { prompt: 10, completion: 5, total: 15 }, cost: 0.02, model: 'gemini-3.8-flash' },
  ];
  const r = syncSession(s, { messages: msgs, startedAt: 5, files: [], activeMs: 0 }, 9);
  assert.deepEqual(r.messages[1].tokens, { prompt: 10, completion: 5, total: 15 });
  assert.equal(r.messages[1].cost, 0.02);
  assert.equal(r.messages[1].model, 'gemini-3.8-flash');
});

test('syncSession: metadata opsional (tanpa field pun tetap aman)', () => {
  const s = createSession(1);
  const r = syncSession(s, { messages: [{ role: 'user', text: 'x' }], startedAt: 5, files: [] }, 9);
  assert.equal(r.messages[0].tokens, undefined);
  assert.equal(r.messages[0].cost, undefined);
});

test('syncSession: buang pesan rusak (tanpa text string) lewat normalizeMessage', () => {
  const s = createSession(1);
  const msgs = [
    null,
    { role: 'user' }, // tanpa text → rusak
    { role: 'user', text: 'baik' },
    { role: 'model', text: 'ok', tokens: { completion: 3 } },
    42, // bukan objek
  ];
  const r = syncSession(s, { messages: msgs, startedAt: 5, files: [], activeMs: 0 }, 9);
  assert.deepEqual(r.messages.map((m) => m.text), ['baik', 'ok']);
  assert.equal(r.messages[1].tokens.completion, 3);
});

test('createSession: struktur dasar tidak berubah (backward compatible)', () => {
  const s = createSession(1000);
  assert.deepEqual(Object.keys(s).sort(), ['activeMs', 'createdAt', 'files', 'id', 'messages', 'startedAt', 'title', 'updatedAt'].sort());
});
