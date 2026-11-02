// =========================================================
// Harness: alur provider kustom (tanpa Gemini bawaan).
// ------------------------------------------------------------
// Buktikan (jalankan kode app.js ASLI via shim DOM):
//   1. Migrasi: settings lama provider:'gemini' → dibersihkan (provider='').
//   2. Kirim pesan dengan endpoint custom (tanpa kunci) → request ke
//      {baseUrl}{chatPath} TANPA header Authorization.
//   3. Footer = "↑ 120 · ↓ 240 token" (token arah) TANPA "~$" (model lokal
//      tak ada harga → tanpa biaya, graceful).
// =========================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = '/tmp/tanyabukan-provider';
fs.mkdirSync(LOG_DIR, { recursive: true });
const logLines = [];
const log = (m) => { logLines.push(m); console.log(m); };

// ---------- SHIM DOM (disalin pola task10 harness) ----------
class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this._className = '';
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.options = [];
    this.parentNode = null;
    this._handlers = {};
    El.registry.push(this);
  }
  get className() { return this._className; }
  set className(v) { this._className = String(v); }
  get firstChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode; }
  set innerHTML(html) {
    this._innerHTML = String(html ?? '');
    const opts = [];
    const re = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = re.exec(this._innerHTML))) {
      const attrs = m[1];
      const valMatch = attrs.match(/value="([^"]*)/);
      opts.push({ value: valMatch ? valMatch[1] : '', text: m[2].trim() });
    }
    this.options = opts;
  }
  get innerHTML() { return this._innerHTML || ''; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : 0;
    this.children.splice(i < 0 ? 0 : i, 0, c);
    return c;
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  append(...kids) { kids.forEach((c) => this.appendChild(c)); return this; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); }
  removeEventListener() {}
  setAttribute(k, v) { if (k === 'class') this.className = v; else this.attributes[k] = v; }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  hasAttribute(k) { return !!(this.attributes[k]); }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  contains() { return false; }
  focus() {}
  click() { (this._handlers.click || []).forEach((fn) => fn()); }
  get classList() {
    const self = this;
    return {
      add: (...cs) => { self._cls = new Set([...(self._cls || []), ...cs]); },
      remove: () => {},
      contains: () => false,
      toggle: () => {},
    };
  }
}
El.registry = [];

const lsMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => lsMap.set(k, String(v)),
  removeItem: (k) => lsMap.delete(k),
  key: (i) => Array.from(lsMap.keys())[i] ?? null,
  get length() { return lsMap.size; },
  clear: () => lsMap.clear(),
};

// Seed settings LAMA (jejak gemini) → harus dibersihkan migrasi.
lsMap.set('tanyabukan.onboardingDone', JSON.stringify(true));
lsMap.set('tanyabukan.settings', JSON.stringify({
  mode: 'konsep', level: 3, provider: 'gemini', model: 'gemini-3.8-flash', webSearch: true, providers: [],
}));

globalThis.document = {
  getElementById: (id) => {
    if (!document._byId[id]) document._byId[id] = new El(id);
    return document._byId[id];
  },
  createElement: (tag) => new El(tag),
  querySelector: () => new El(),
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  activeElement: new El(),
  _byId: {},
};
globalThis.window = {
  location: { href: 'http://127.0.0.1:5500/' },
  navigator: { userAgent: 'node' },
  matchMedia: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// ---------- MOCK fetch ----------
const fetchCalls = [];
globalThis.fetch = async (url, init = {}) => {
  fetchCalls.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: 'Jawaban tutor dari endpoint lokal.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 240, total_tokens: 360 },
    }),
  };
};

const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log('== Harness: provider kustom tanpa Gemini bawaan ==');

  const app = await import(`${ROOT}/js/app.js?v=provider`);

  // ===== FASE 1: MIGRASI settings lama =====
  assert.equal(app.state.settings.provider, '', 'provider gemini harus dibersihkan');
  assert.equal(app.state.settings.model, '', 'model gemini-* harus dibersihkan');
  log('[OK] Fase 1: migrasi — provider & model gemini dari settings lama dibersihkan (onboarding muncul lagi).');

  // ===== FASE 2: kirim pesan via endpoint custom tanpa kunci =====
  const LOCAL = {
    id: 'ep-local', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234',
    modelsPath: '/models', chatPath: '/chat/completions', key: '',
    supportsGrounding: false, supportsThinking: false, custom: true,
  };
  app.state.settings.providers = [LOCAL];
  app.state.settings.provider = 'ep-local';
  app.state.settings.model = 'qwen2.5-7b-instruct';
  app.state.materiFiles = [{ name: 'materi.txt', chars: 10, text: 'Materi uji.' }];

  await app.sendUserMessage('Apa itu fotosintesis?');
  await flush();

  const modelMsg = [...app.state.messages].reverse().find((m) => m.role === 'model');
  assert(modelMsg, 'balasan model harus ada');
  assert.equal(modelMsg.tokens.completion, 240, 'tokens.completion dari usage mock');
  assert.equal(modelMsg.tokens.prompt, 120, 'tokens.prompt dari usage mock');
  log(`[OK] Fase 2: tokens = ${JSON.stringify(modelMsg.tokens)} (dari kirim pertama via endpoint custom).`);

  const chatCall = fetchCalls.find((c) => c.url.includes('/chat/completions'));
  assert(chatCall, 'harus ada POST ke /chat/completions');
  assert.equal(chatCall.url, 'http://127.0.0.1:1234/chat/completions');
  assert.equal(chatCall.init.headers.Authorization, undefined, 'kunci kosong → TANPA header Authorization');
  const body = JSON.parse(chatCall.init.body);
  assert.equal(body.model, 'qwen2.5-7b-instruct');
  log(`[OK] Fase 2: POST ${chatCall.url} tanpa header auth; body.model = ${body.model}.`);

  // ===== FASE 3: footer "↑ in · ↓ out token" tanpa biaya =====
  const footers = El.registry.filter((e) => e.className === 'msg__footer');
  assert(footers.length >= 1, 'footer harus dirender');
  const ftext = footers[footers.length - 1].textContent;
  assert.equal(ftext, '↑ 120 · ↓ 240 token', `footer harus "↑ 120 · ↓ 240 token", dapat: "${ftext}"`);
  assert.ok(!ftext.includes('~$'), 'model lokal tanpa harga → TIDAK ada estimasi biaya');
  log(`[OK] Fase 3: footer = "${ftext}" (tanpa biaya — graceful).`);

  log('');
  log('SEMUA ASSERTION PASS — provider kustom + token ↑↓ + migrasi bekerja.');

  fs.writeFileSync(`${LOG_DIR}/harness-log.md`, logLines.join('\n') + '\n');
  console.log(`\nLog: ${LOG_DIR}/harness-log.md`);
  process.exit(0); // timer sesi (setInterval) menjaga event loop — keluar eksplisit.
}

main().catch((err) => {
  console.error('GAGAL:', err && (err.stack || err.message || err));
  process.exit(1);
});
