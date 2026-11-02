// tests/chat-footer.test.mjs — format footer token ↑↓ + biaya bersyarat.
import test from 'node:test';
import assert from 'node:assert/strict';

// Shim DOM minimal untuk memuat chat.js (butuh document.createElement dll).
const el = () => ({
  children: [],
  className: '',
  textContent: '',
  style: {},
  dataset: {},
  appendChild(c) { this.children.push(c); return c; },
  addEventListener() {},
  querySelector() { return null; },
  remove() {},
});
globalThis.document = {
  createElement: el,
  createTextNode: (t) => ({ text: t }),
  getElementById: () => null,
  addEventListener() {},
  body: { appendChild() {} },
};
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.location = { protocol: 'file:' };

const { addCostFooter } = await import('../js/chat.js');

function footText(tokens, cost) {
  const col = el();
  const foot = addCostFooter(col, tokens, cost);
  return foot ? foot.textContent : null;
}

test('footer: token masuk & keluar → "↑ 320 · ↓ 240 token"', () => {
  assert.equal(footText({ prompt: 320, completion: 240, total: 560 }), '↑ 320 · ↓ 240 token');
});

test('footer: hanya completion → "↓ 240 token"', () => {
  assert.equal(footText({ completion: 240 }), '↓ 240 token');
});

test('footer: cost number → ditambah "~$X.XX"; model lokal (cost null) → token saja', () => {
  assert.equal(footText({ prompt: 320, completion: 240 }, 0.001), '↑ 320 · ↓ 240 token · ~$0.00');
  assert.equal(footText({ prompt: 320, completion: 240 }, null), '↑ 320 · ↓ 240 token');
});

test('footer: semua kosong → null (tidak dirender)', () => {
  assert.equal(footText(undefined, null), null);
  assert.equal(footText({}, null), null);
  assert.equal(footText({ prompt: 10 }, null), null); // tanpa completion → kosong
});
