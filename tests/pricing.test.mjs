// tests/pricing.test.mjs — API tanpa hardcode: harga & kurs dinamis.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateCost, formatCost, formatCostIDR,
  cachedUsdIdr, cacheUsdIdr, effectiveUsdIdr,
} from '../js/pricing.js';

// localStorage shim untuk Node.
const lsMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => lsMap.set(k, String(v)),
  removeItem: (k) => lsMap.delete(k),
};

test('estimateCost: harga dari sumber dinamis (bukan tabel bawaan)', () => {
  const price = { input: 2.5, output: 10 }; // mis. dari endpoint OpenRouter
  // 1M in × $2.5 + 1M out × $10 = $12.5
  assert.equal(estimateCost(price, { prompt: 1000000, completion: 1000000 }), 12.5);
  // hanya output yang punya harga 0 → input tetap dihitung
  assert.equal(estimateCost({ input: 0, output: 0 }, { prompt: 5000, completion: 1000 }), 0);
  // price null / rusak → null (UI tampil token saja)
  assert.equal(estimateCost(null, { prompt: 1 }), null);
  assert.equal(estimateCost({}, { prompt: 1 }), null);
});

test('kurs: cache + TTL + override manual menang', () => {
  const now = Date.now();
  assert.equal(cachedUsdIdr(now), null);        // belum ada cache
  cacheUsdIdr(16300, now);
  assert.equal(cachedUsdIdr(now), 16300);       // dari cache
  assert.equal(cachedUsdIdr(now + 25 * 3600e3), null); // kedaluwarsa >24 jam
  // override manual user selalu menang atas cache
  assert.equal(effectiveUsdIdr('15000'), 15000);
  assert.equal(effectiveUsdIdr(''), 16300);     // kosong → cache
  cacheUsdIdr(16300, now - 25 * 3600e3);        // cache basi + tanpa manual → null
  assert.equal(effectiveUsdIdr(''), null);
});

test('formatCostIDR: Rupiah pemisah ribuan; tanpa kurs → null', () => {
  assert.equal(formatCostIDR(1, 16300), 'Rp16.300');
  assert.equal(formatCostIDR(0, 16300), 'Rp0');   // model lokal
  assert.equal(formatCostIDR(0.5, 16300), 'Rp8.150');
  assert.equal(formatCostIDR(1, null), null);
});

test('formatCost: USD internal (ekspor)', () => {
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(2.5), '$2.50');
});
