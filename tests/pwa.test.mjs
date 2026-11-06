import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_VERSION, PRECACHE_ASSETS, isOwnAsset, selectStrategy } from '../js/pwa-cache.js';
import { shouldPromptUpdate } from '../js/pwa.js';

const ORIGIN = 'http://localhost/';

test('pwa-cache: CACHE_VERSION statik & pola vN', () => {
  assert.match(CACHE_VERSION, /^tanyabukan-shell-v\d+$/);
});

test('pwa-cache: PRECACHE_ASSETS memuat app shell inti', () => {
  for (const a of ['./index.html', './css/variables.css', './js/app.js', './manifest.json']) {
    assert.ok(PRECACHE_ASSETS.includes(a), `harus precache ${a}`);
  }
});

test('pwa-cache: isOwnAsset — relatif & same-origin true; cross-origin false; non-string false', () => {
  assert.equal(isOwnAsset('./css/main.css', ORIGIN), true);
  assert.equal(isOwnAsset('http://localhost/js/app.js', ORIGIN), true);
  assert.equal(isOwnAsset('https://api.openai.com/v1/chat/completions', ORIGIN), false);
  assert.equal(isOwnAsset(42, ORIGIN), false);
});

test('pwa-cache: selectStrategy — sw.js network-only; own cache-first; api network-first', () => {
  assert.equal(selectStrategy('http://localhost/sw.js', ORIGIN), 'network-only');
  assert.equal(selectStrategy('./css/main.css', ORIGIN), 'cache-first');
  assert.equal(selectStrategy('https://api.example.com/data', ORIGIN), 'network-first');
});

test('pwa: shouldPromptUpdate — true saat SW menunggu update; false bila tidak', () => {
  assert.equal(shouldPromptUpdate({ installing: false, installed: true, waiting: true, activating: false }), true);
  assert.equal(shouldPromptUpdate({ installing: true, installed: false, waiting: false, activating: false }), false);
  assert.equal(shouldPromptUpdate({}), false);
});
