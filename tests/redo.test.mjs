// Jalankan: node --test tests/redo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { planRedo, planEdit } from '../js/redo.js';

const msgs = [
  { role: 'user', text: 'Q1' },
  { role: 'model', text: 'A1' },
  { role: 'user', text: 'Q2' },
  { role: 'model', text: 'A2' }, // balasan terakhir
];

test('planRedo: isi contents = semua sebelum balasan model terakhir', () => {
  const p = planRedo(msgs);
  assert.equal(p.modelIndex, 3);
  assert.deepEqual(p.contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ]);
});

test('planRedo: null bila tak ada balasan model', () => {
  assert.equal(planRedo([{ role: 'user', text: 'Q' }]), null);
  assert.equal(planRedo([]), null);
});

test('planEdit: contents sampai & termasuk user yang disunting, firstModelIndex setelahnya', () => {
  // sunting Q1 (idx 0) → regenerasi A1 (idx1) & A2 (idx3)
  const p = planEdit(msgs, 0);
  assert.deepEqual(p.contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ]);
  assert.equal(p.firstModelIndex, 1);
});

test('planEdit: sunting Q2 (idx2) → regenerasi A2 saja', () => {
  const p = planEdit(msgs, 2);
  assert.deepEqual(p.contents, [{ role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }, { role: 'user', text: 'Q2' }]);
  assert.equal(p.firstModelIndex, 3);
});

test('planRedo/edit: abaikan pesan hidden & non-user/model', () => {
  const mixed = [
    { role: 'system', text: 'catatan', hidden: true },
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
  ];
  const p = planRedo(mixed);
  assert.deepEqual(p.contents, [{ role: 'user', text: 'Q1' }]);
});
