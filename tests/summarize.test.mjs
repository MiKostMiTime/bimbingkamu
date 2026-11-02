// tests/summarize.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUMMARY_THRESHOLD, needsSummarize, splitForSummary,
  summarySystemPrompt, summaryMessage, buildContentsFrom,
} from '../js/summarize.js';

test('needsSummarize: ambang >= 80% context window', () => {
  assert.equal(needsSummarize(100000, 262144), false); // ~38%
  assert.equal(needsSummarize(200000, 262144), false); // ~76% (< 80%)
  assert.equal(needsSummarize(210000, 262144), true);  // ~80.1%
  assert.equal(needsSummarize(250000, 262144), true);
  assert.equal(needsSummarize(130000, 131072), true);  // ~99%
  assert.equal(needsSummarize(50000, null), false);     // limit tak diketahui
  assert.equal(needsSummarize(0, 100000), false);       // belum ada token
});

test('splitForSummary: pisahkan lama & baru; pertahankan model di bagian lama', () => {
  const msgs = [
    { role: 'user', text: 'sapaan' },          // hidden opening (model context)
    { role: 'model', text: 'halo' },
    { role: 'user', text: 'pertanyaan A' },
    { role: 'model', text: 'jawaban A' },
    { role: 'user', text: 'pertanyaan B' },
    { role: 'model', text: 'jawaban B' },
  ];
  const split = splitForSummary(msgs, 2); // pertahankan 2 terakhir (B + jawabannya)
  assert.equal(split.older.length, 4);     // sapaan, A, jawabanA? -> sapaan+model+hanya...
  // 6 - 2 = 4: [sapaan, model, userA, modelA]
  assert.deepEqual(split.recent.map((m) => m.text), ['pertanyaan B', 'jawaban B']);
});

test('splitForSummary: null bila tak ada balasan model di bagian lama', () => {
  const msgs = [
    { role: 'user', text: 'sapaan' },
    { role: 'model', text: 'halo' },
    { role: 'user', text: 'baru' }, // idx=1 -> older=[sapaan], tak ada model
  ];
  const split = splitForSummary(msgs, 2);
  assert.equal(split, null);
});

test('summaryMessage: role user + hidden + summary', () => {
  const msg = summaryMessage('ringkasan isi');
  assert.equal(msg.role, 'user');
  assert.equal(msg.hidden, true);
  assert.equal(msg.summary, true);
  assert.ok(/RINGK/i.test(msg.text));
});

test('buildContentsFrom: filter role user/model jadi array role/text', () => {
  const msgs = [
    { role: 'user', text: 'a' },
    { role: 'model', text: 'b' },
    { role: 'notice', text: 'c' }, // dikecualikan
  ];
  assert.deepEqual(buildContentsFrom(msgs), [
    { role: 'user', text: 'a' },
    { role: 'model', text: 'b' },
  ]);
});

test('summarySystemPrompt: ringkasan dalam Bahasa Indonesia', () => {
  const p = summarySystemPrompt();
  assert.ok(p.includes('Bahasa Indonesia'));
  assert.ok(p.length > 50);
});
