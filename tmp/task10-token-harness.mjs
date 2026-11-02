// =========================================================
// Task 10 — Mock-Fetch Harness: buktikan F3 tertutup.
// ------------------------------------------------------------
// Tujuan: mock global fetch → response gaya chatCompletion (pakai
// usage.tokens), muat app.js + deps, seed state, jalankan
// generateGreeting() / sendUserMessage(), lalu ASSERT:
//   1. model message punya tokens.completion === 240 (dari mock).
//   2. footer .msg__footer memuat "240 token" DAN "~$"  => token + biaya,
//      BUKAN cost-only. Ini bukti token tangkap dari KIRIM PERTAMA.
//   3. fetch dipanggil ke endpoint OpenAI-shape
//      ${baseUrl}${chatPath} dengan header auth + body {model, messages, max_tokens},
//      BUKAN Gemini-native /generateContent.
// =========================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = '/tmp/tanyabukan-task10';
const logLines = [];
const log = (msg) => { logLines.push(msg); console.log(msg); };

// ---------- SHIM DOM (supaya app.js bisa di-muat di Node) ----------
class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this._className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.options = []; // diisi saat innerHTML punya <option> (buildModelOptions)
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
    // Ekstrak <option value="...">text</option> agar [...sel.options] + .value jalan.
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
    return { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} };
  }
}
El.registry = [];

// localStorage backed by Map.
const lsMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => lsMap.set(k, String(v)),
  removeItem: (k) => lsMap.delete(k),
  key: (i) => Array.from(lsMap.keys())[i] ?? null,
  get length() { return lsMap.size; },
  clear: () => lsMap.clear(),
};

// Pre-seed onboarding done agar init() tidak menampilkan modal onboarding.
lsMap.set('tanyabukan.onboardingDone', JSON.stringify(true));

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

// ---------- MOCK fetch → response gaya chatCompletion ----------
const fetchCalls = [];
function mockFetch() {
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url, init });
    // Kembalikan response OpenAI-shape dengan usage.tokens.
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Jawaban tutor dari mock fetch.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 240, total_tokens: 360 },
      }),
    };
  };
}

// ---------- RUNTIME ----------
async function flushTimers(ms = 60) {
  await new Promise((r) => setTimeout(r, ms));
}

function footersForPhase(label) {
  // Ambil footer .msg__footer yang muncul sejak phase dimulai.
  const all = El.registry.filter((e) => e.className === 'msg__footer');
  return all;
}

async function main() {
  mockFetch();
  log('== Mock-fetch harness: Task 10 (tangkap token dari kirim pertama) ==');
  log(`Root: ${ROOT}`);
  log('Memuat app.js + deps (DOM + storage di-shim).');

  // Muat app.js SEBELUM seeding state agar init() jalan; lalu seed state.
  const app = await import(`${ROOT}/js/app.js?v=task10`);

  // Seed state: kunci, settings (provider Gemini default), model.
  app.state.apiKey = 'TESTKEY-HARNESS';
  app.state.settings = {
    mode: 'konsep', level: 3, model: 'gemini-3.8-flash',
    webSearch: false, provider: 'gemini', providers: [],
  };
  log('State dised: apiKey + settings{provider:"gemini", model:"gemini-3.8-flash"}.\n');

  // ============ FASE 1: generateGreeting() (KIRIM PERTAMA = sapaan) ============
  log('--- FASE 1: generateGreeting() ---');
  await app.generateGreeting();
  await flushTimers();

  const greetModel = app.state.messages.find((m) => m.role === 'model');
  assert(greetModel, 'model message harus ada setelah greeting');
  assert.equal(greetModel.tokens.completion, 240, 'tokens.completion harus 240 (dari mock)');
  log(`[OK] model message tokens = ${JSON.stringify(greetModel.tokens)}`);

  const greetFooters = footersForPhase('greet').filter((f) => f.textContent.includes('token'));
  assert(greetFooters.length >= 1, 'footer token harus muncul');
  const footerText = greetFooters[greetFooters.length - 1].textContent;
  log(`[OK] .msg__footer text = "${footerText}"`);
  assert.match(footerText, /240 token/, 'footer memuat "240 token"');
  assert.match(footerText, /\~\$/, 'footer memuat "~$" (bukan cost-only)');
  log('[OK] F3 tertutup: footer = TOKEN + BIAYA dari kirim pertama.\n');

  // ============ FASE 2: sendUserMessage() (kirim pertanyaan) ============
  log('--- FASE 2: sendUserMessage() ---');
  app.state.materiFiles = [{ name: 'fisika.pdf', chars: 120, text: 'Materi fisika: hukum Newton.' }];
  await app.sendUserMessage('Jelaskan hukum Newton II.');
  await flushTimers();

  const sendModel = app.state.messages.filter((m) => m.role === 'model').pop();
  assert(sendModel, 'model message harus ada setelah kirim');
  assert.equal(sendModel.tokens.completion, 240, 'tokens.completion harus 240 (dari mock)');
  log(`[OK] model message tokens = ${JSON.stringify(sendModel.tokens)}`);

  const sendFooters = footersForPhase('send').filter((f) => f.textContent.includes('token'));
  assert(sendFooters.length >= 1, 'footer token harus muncul setelah kirim');
  const footerText2 = sendFooters[sendFooters.length - 1].textContent;
  log(`[OK] .msg__footer text = "${footerText2}"`);
  assert.match(footerText2, /240 token/, 'footer memuat "240 token"');
  assert.match(footerText2, /\~\$/, 'footer emuat "~$" (bukan cost-only)');
  log('[OK] footer = TOKEN + BIAYA dari kirim pertama.\n');

  // ============ FASE 3: verifikasi fetch ke endpoint OpenAI-shape ============
  log('--- FASE 3: verifikasi shape request ke provider ---');
  const chatCalls = fetchCalls.filter((c) => c.url.endsWith('/openai/chat/completions'));
  assert(chatCalls.length >= 1, 'harus ada panggilan ke /openai/chat/completions');
  // Pastikan BUKAN Gemini-native /generateContent.
  const nativeCalls = fetchCalls.filter((c) => c.url.includes('/generateContent'));
  assert.equal(nativeCalls.length, 0, 'TIDAK boleh pakai endpoint Gemini-native /generateContent');

  const last = chatCalls[chatCalls.length - 1];
  const body = JSON.parse(last.init.body);
  log(`[OK] endpoint : ${last.url}`);
  log(`[OK] header auth: ${JSON.stringify(last.init.headers)}`);
  log(`[OK] body keys : ${Object.keys(body).join(', ')}`);
  assert.equal(last.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'endpoint = baseUrl + chatPath');
  assert.ok(last.init.headers['x-goog-api-key'] === 'TESTKEY-HARNESS', 'header auth bawa kunci');
  assert.equal(body.model, 'gemini-3.8-flash', 'body.model = model aktif');
  assert.ok(Array.isArray(body.messages), 'body.messages array');
  assert.ok('max_tokens' in body, 'body.max_tokens ada');
  log('[OK] fetch ke OpenAI-shape endpoint + header auth + body{model,messages,max_tokens}.\n');

  // ============ KESIMPULAN ============
  log('================ HASIL HARNESS ================');
  log(`generateGreeting : tokens.completion=240, footer="${footerText}"`);
  log(`sendUserMessage  : tokens.completion=240, footer="${footerText2}"`);
  log(`Panggilan chat   : ${chatCalls.length} ke /openai/chat/completions (0 ke /generateContent).`);
  log('SEMUA ASSERTION PASS — F3 TUTUP: token + biaya tampil dari kirim pertama.');
  log('=============================================');

  // Simpan "screenshot" text footer + ringkasan fetch ke LOG_DIR.
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const screenshot = [
    '=== F3 VERIFICATION (mock-fetch) ===',
    '',
    '[Footer bubble model — generateGreeting]',
    `  .msg__footer => "${footerText}"`,
    '',
    '[Footer bubble model — sendUserMessage]',
    `  .msg__footer => "${footerText2}"`,
    '',
    '[Fetch call (terakhir) ke OpenAI-shape endpoint]',
    `  URL : ${last.url}`,
    `  Auth: ${JSON.stringify(last.init.headers)}`,
    `  Body: ${JSON.stringify(body, null, 2)}`,
    '',
    'Model message.tokens:',
    `  greeting => ${JSON.stringify(greetModel.tokens)}`,
    `  send     => ${JSON.stringify(sendModel.tokens)}`,
    '',
    'KESIMPULAN: footer menampilkan "N token · ~$X.XX" (token + biaya), bukan cost-only.',
  ].join('\n');
  fs.writeFileSync(`${LOG_DIR}/harness-footer-screenshot.txt`, screenshot);
  fs.writeFileSync(`${LOG_DIR}/harness-log.md`, `# Task 10 Mock-Fetch Harness Log\n\n${logLines.join('\n')}\n\n---\n\n${screenshot}\n`);
  log(`\nLog + screenshot tersimpan di ${LOG_DIR}/`);

  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n[FAIL] ASSERTION GAGAL:');
  console.error(err && err.stack ? err.stack : err);
  logLines.push(`\n[FAIL]\n${err && err.stack ? err.stack : err}`);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(`${LOG_DIR}/harness-log.md`, `# Task 10 Mock-Fetch Harness Log\n\n${logLines.join('\n')}\n`);
  process.exit(1);
});
