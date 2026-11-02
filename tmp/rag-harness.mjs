// =========================================================
// Harness RAG: alur kirim pesan dengan materi tebal.
// ------------------------------------------------------------
// Buktikan (jalankan kode app.js ASLI via shim DOM):
//   1. Materi tebal multi-paragraf + paragraf TIDAK relevan.
//   2. sendUserMessage('bagaimana peran klorofil...') ->
//      POST /chat/completions HARUS kirim system.content = paragraf
//      TERRELEVAN (klorofil/fotosintesis), BUKAN seluruh isi materi,
//      dan MENGEUALKAN paragraf tidak relevan (vitamin C).
// =========================================================
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logLines = [];
const log = (m) => { logLines.push(m); console.log(m); };

// ---------- SHIM DOM (pola sama seperti provider-harness) ----------
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
    El.registry.push(this);
  }
  get className() { return this._className; }
  set className(v) { this._className = String(v); }
  get classList() {
    const self = this;
    const set = (add) => (v) => {
      const cur = String(self._className).split(/\s+/).filter(Boolean);
      if (add) { if (!cur.includes(v)) cur.push(v); } else { const i = cur.indexOf(v); if (i >= 0) cur.splice(i, 1); }
      self._className = cur.join(' ');
    };
    return { add: set(true), remove: set(false), contains: (v) => String(self._className).split(/\s+/).includes(v), toggle: (v) => { const cur = String(self._className).split(/\s+/).filter(Boolean); const i = cur.indexOf(v); if (i >= 0) cur.splice(i, 1); else cur.push(v); self._className = cur.join(' '); } };
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  prepend(c) { c.parentNode = this; this.children.unshift(c); return c; }
  append(...cs) { cs.forEach((c) => { c.parentNode = this; this.children.push(c); }); }
  replaceChildren(...cs) { this.children = []; cs.forEach((c) => { c.parentNode = this; this.children.push(c); }); }
  insertBefore(c, ref) {
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : 0;
    this.children.splice(i < 0 ? 0 : i, 0, c);
    return c;
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener() {}
  removeEventListener() {}
  focus() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 1000, right: 1000 }; }
  cloneNode() { const c = new El(this.tagName); c._className = this._className; return c; }
  matches(sel) { if (sel && sel.startsWith('.')) return String(this._className).split(/\s+/).includes(sel.slice(1)); return false; }
}
El.registry = [];

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

// ---------- MOCK fetch: tangkap body, kembalikan usage + content ----------
const fetchCalls = [];
globalThis.fetch = async (url, init = {}) => {
  fetchCalls.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: 'Jawaban tutor berbasis RAG.' } }],
      usage: { prompt_tokens: 150, completion_tokens: 90, total_tokens: 240 },
    }),
  };
};

const flush = (ms = 80) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log('== Harness RAG: kirim pesan + trim materi per-paragraf ==');
  const app = await import(`${ROOT}/js/app.js?v=rag`);

  // Provider lokal (LM Studio mock).
  const LOCAL = {
    id: 'ep-local', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234',
    modelsPath: '/models', chatPath: '/chat/completions', key: '',
    supportsGrounding: false, supportsThinking: false, custom: true,
  };
  app.state.settings.providers = [LOCAL];
  app.state.settings.provider = 'ep-local';
  app.state.settings.model = 'google/gemma-4-e4b';

  // Materi tebal: 3 paragraf fotosintesis + 1 TIDAK relevan (buah/vitamin C).
  const materi = [
    'Fotosintesis adalah proses tumbuhan hijau mengubah cahaya matahari menjadi energi kimia dalam bentuk gula. Proses ini terjadi di kloroplas, khususnya di dalam klorofil yang menyerap cahaya merah and biru.',
    'Klorofil adalah pigmen hijau yang memungkinkan reaksi fotosintesis terjadi. Tanpa klorofil, tumbuhan tidak bisa menangkap energi cahaya untuk sintesis gula.',
    'Rekah terang fotosintesis membutuhkan matahari untuk memecah air (fotolisis) dan menghasilkan ATP serta NADPH. Rekah gelap (sikulus Calvin) menggunakan ATP dan NADPH untuk mengubah karbondioksida menjadi gula.',
    'Buah adalah bagian bunga yang berkembang setelah pembuahan, umumnya berisi biji dan kaya vitamin C untuk kesehatan mata.',
  ].join('\n\n');
  app.state.materiFiles = [{ name: 'biologi.txt', chars: materi.length, text: materi }];

  // Kirim pertanyaan tentang klorofil -> RAG harus memilih paragraf relevan.
  await app.sendUserMessage('bagaimana peran klorofil dalam fotosintesis?');
  await flush();

  const chatCall = fetchCalls.find((c) => c.url.includes('/chat/completions'));
  assert(chatCall, 'harus ada POST ke /chat/completions');
  const body = JSON.parse(chatCall.init.body);

  // system.content = hasil buildMateriFor(query) -> paragraf terpilih.
  const sysContent = (body.messages.find((m) => m.role === 'system') || {}).content || '';
  log(`\n[info] system.content RAG: ${sysContent.length} karakter`);

  // 1) Paragraf relevan HARUS ada (teks paragraf utuh -> bukti seleksi per-paragraf).
  assert(sysContent.includes('klorofil yang menyerap cahaya merah and biru'), 'paragraf 1 (klorofil) harus terpilih');
  assert(sysContent.includes('Klorofil adalah pigmen hijau yang memungkinkan'), 'paragraf 2 (klorofil) harus terpilih');
  log('[OK] RAG memilih paragraf relevan (klorofil + fotosintesis).');

  // 2) Paragraf TIDAK relevan HARUS dikecualikan.
  assert(!sysContent.includes('vitamin C untuk kesehatan mata'), 'paragraf vitamin C harus dikecualikan');
  assert(!sysContent.includes('Buah adalah bagian bunga yang berkembang'), 'paragraf buah harus dikecualikan');
  log('[OK] RAG mengeUALKAN paragraf tidak relevan (buah / vitamin C).');

  // 3) Bukti memangkas: materi utuh (=695 char, incl. vitamin C) TIDAK muncul utuh
  //    di system.content -> berarti bagian materi dipangkas & dipilih ulang.
  const full = app.state.materiFiles[0].text;
  assert(!sysContent.includes(full), 'materi utuh harus dipangkas (RAG memilih ulang paragraf)');
  log(`[OK] Materi utuh (${full.length} char) dipangkas -> hanya paragraf terpilih di system.content.`);

  // 4) Isi percakapan (contents) tetap ikut.
  const userMsg = body.messages.find((m) => m.role === 'user');
  assert(userMsg, 'harus ada pesan user di contents');
  assert(userMsg.content.includes('peran klorofil'), 'pertanyaan user harus di isi');
  log('[OK] Pertanyaan user tetap dikirim di contents.');

  log('\nSEMUA ASSERTION PASS — RAG per-paragraf bekerja di jalur kirim nyata.');
  process.exit(0);
}

main().catch((err) => {
  console.error('GAGAL:', err && (err.stack || err.message || err));
  process.exit(1);
});
