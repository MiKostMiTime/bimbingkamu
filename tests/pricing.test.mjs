// tests/pricing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICES, findPrice, estimateCost, formatCost } from '../js/pricing.js';

test('findPrice: model dikenal + prefix wildcard', () => {
  assert.deepEqual(findPrice('gemini-3.8-flash'), { input: 0.5, output: 4 });
  assert.deepEqual(findPrice('qwen-max'), { input: 0, output: 0 }); // qwen-*
  assert.equal(findPrice('model-tidak-dikenal'), null);
});

test('estimateCost: token keluar × harga output', () => {
  // gemini-3.8-flash output $4/1M → 1.000.000 completion = $4
  assert.equal(estimateCost('gemini-3.8-flash', { completion: 1000000 }), 4);
  assert.equal(estimateCost('gemini-3.8-flash', { prompt: 10, completion: 500 }), 0.002);
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
