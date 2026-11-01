// Jalankan: node --test tests/redo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { planRedo, planEdit, applyRedo, planEditRegenerations } from '../js/redo.js';

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

test('planEdit: fallback editIdx+1 bila tak ada pesan user', () => {
  // Tanpa user: contents = slice(0, editIdx+1), firstModelIndex setelahnya.
  const noUser = [{ role: 'model', text: 'A0' }, { role: 'model', text: 'A1' }];
  const p = planEdit(noUser, 0);
  assert.deepEqual(p.contents, [{ role: 'model', text: 'A0' }]);
  assert.equal(p.firstModelIndex, 1);
});

test('planEdit: firstModelIndex -1 bila tak ada model setelah titik sunting', () => {
  // Sunting Q2 (idx2) di [Q1, A1, Q2] → tak ada balasan afterward.
  const p = planEdit(
    [{ role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }, { role: 'user', text: 'Q2' }],
    2,
  );
  assert.deepEqual(p.contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ]);
  assert.equal(p.firstModelIndex, -1);
});

test('planRedo/edit: tahan entry non-objek (null) tanpa lempar error', () => {
  const messy = [null, { role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }];
  assert.doesNotThrow(() => planRedo(messy));
  const p = planEdit(messy, 1); // sunting user di idx1
  assert.deepEqual(p.contents, [{ role: 'user', text: 'Q1' }]);
  assert.equal(p.firstModelIndex, 2);
});

test('applyRedo: membungkus plan menjadi instruksi regenerasi', () => {
  const msgs = [{ role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }];
  const plan = applyRedo(msgs, planRedo(msgs));
  assert.equal(plan.modelIndex, 1);
  assert.deepEqual(plan.contents, [{ role: 'user', text: 'Q1' }]);
});

test('applyRedo: null bila modelIndex di luar rentang', () => {
  assert.equal(applyRedo([{ role: 'model', text: 'A' }], { modelIndex: 5, contents: [] }), null);
  assert.equal(applyRedo([], {}), null);
});

// ===== EDIT (SUNTING): planEditRegenerations =====
// Aturan turunan: model PERTAMA disertakan jawaban lamanya sebagai konteks;
// model berikutnya berhenti pada user-prompt sebelumnya. User-prompt selalu ikut.
test('planEditRegenerations: urutan regenerasi multi-turn setelah edit', () => {
  const msgs = [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
    { role: 'model', text: 'A2' },
  ];
  const regs = planEditRegenerations(msgs, 0); // sunting Q1
  assert.equal(regs.length, 2);
  // Reg #1: isi sampai Q1 (+ A1 lama sebagai konteks), target model idx1
  assert.deepEqual(regs[0].contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
  ]);
  assert.equal(regs[0].modelIndex, 1);
  // Reg #2: isi sampai Q2 (dengan A1 baru), target model idx3
  assert.deepEqual(regs[1].contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ]);
  assert.equal(regs[1].modelIndex, 3);
});

test('planEditRegenerations: sunting balasan terakhir hanya 1 reg', () => {
  const msgs = [{ role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }];
  assert.equal(planEditRegenerations(msgs, 0).length, 1);
});

test('planEditRegenerations: edit Q2 hanya regenerasi A2, tetap simpan Q1,A1', () => {
  const msgs = [
    { role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' }, { role: 'model', text: 'A2' },
  ];
  const regs = planEditRegenerations(msgs, 2); // sunting Q2 (idx2)
  assert.equal(regs.length, 1);
  assert.deepEqual(regs[0].contents, [
    { role: 'user', text: 'Q1' }, { role: 'model', text: 'A1' }, { role: 'user', text: 'Q2' },
  ]);
  assert.equal(regs[0].modelIndex, 3);
});

test('planEditRegenerations: tak ada model setelah edit → array kosong', () => {
  const msgs = [{ role: 'user', text: 'Q1' }, { role: 'user', text: 'Q2' }];
  assert.deepEqual(planEditRegenerations(msgs, 0), []);
});

test('planEditRegenerations: abaikan entry non-objek & peran di luar user/model', () => {
  const msgs = [
    null,
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'system', text: 'catatan' },
    { role: 'user', text: 'Q2' },
    { role: 'model', text: 'A2' },
  ];
  const regs = planEditRegenerations(msgs, 1); // sunting Q1 (idx1)
  assert.equal(regs.length, 2);
  assert.deepEqual(regs[0].contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
  ]);
  assert.deepEqual(regs[1].contents, [
    { role: 'user', text: 'Q1' },
    { role: 'model', text: 'A1' },
    { role: 'user', text: 'Q2' },
  ]);
});
