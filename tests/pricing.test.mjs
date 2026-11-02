// tests/pricing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICES, findPrice, estimateCost, formatCost } from '../js/pricing.js';

test('findPrice: model dikenal + prefix wildcard', () => {
  assert.deepEqual(findPrice('gpt-4o-mini'), { input: 0.15, output: 0.6 });
  assert.deepEqual(findPrice('qwen-max'), { input: 0, output: 0 }); // qwen-*
  assert.equal(findPrice('model-tidak-dikenal'), null);
  assert.equal(findPrice(''), null);
});

test('estimateCost: token keluar × harga output', () => {
  // gpt-4o output $10/1M → 1.000.000 completion = $10
  assert.equal(estimateCost('gpt-4o', { completion: 1000000 }), 10);
  assert.equal(estimateCost('gpt-4o-mini', { prompt: 10, completion: 500 }), 0.0003);
  // gratis → $0
  assert.equal(estimateCost('qwen-max', { completion: 9999 }), 0);
});

test('estimateCost: model unknown → null (tampilkan token saja)', () => {
  assert.equal(estimateCost('model-x', { completion: 100 }), null);
});

test('formatCost: 2 desimal dengan $', () => {
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(2.5), '$2.50');
});
