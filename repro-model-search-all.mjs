// =========================================================
// BimbingKamu — verifikasi model-search di SETIAP ENDPOINT
// (real browser, live Electron Hub). Menguji pencarian manual
// pada #modelSelect untuk SEMUA jenis endpoint:
//   1. Seed provider via providerSelect (OpenRouter)
//   2. Seed provider via providerSelect (Gemini AI Studio)
//   3. Endpoint custom via modal "Tambah endpoint" (Electron Hub)
// Setiap pergantian endpoint → dropdown rebuild → search tetap ada &
// berfungsi (reset filter lama, badge + clear button utuh).
// Jalankan: node repro-model-search-all.mjs
// =========================================================
import { chromium } from 'playwright-core';

const CHROME = '/Users/deddybathara/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'http://localhost:8080';
const OUT = process.env.OUT || '/tmp/repro-model-search-all';

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const browser = await chromium.launch({ executablePath: CHROME, headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`  [shot] ${name}.png`);
}
async function log(label, obj) { console.log(`  [${label}] ${JSON.stringify(obj)}`); }

// readState sebagai FUNGSI agar page.evaluate bisa meneruskan argumen (id).
const readState = (id) => {
  const sel = document.getElementById(id);
  if (!sel) return null;
  const opts = Array.from(sel.options);
  const scope = sel.closest('.field') || sel.parentElement;
  return {
    total: opts.length,
    visible: opts.filter((o) => !o.hidden).length,
    selected: sel.value,
    badge: scope?.querySelector('.model-search__count')?.textContent ?? null,
    hasSearchInput: Boolean(scope?.querySelector('.model-search__input')),
    hasClearBtn: Boolean(scope?.querySelector('.model-search__clear')),
  };
};

// Ketik teks ke input search dengan dispatch 'input' per karakter (debounce 100ms).
async function typeIntoSearch(id, text) {
  await page.evaluate(({ id, text }) => {
    const sel = document.getElementById(id);
    const scope = sel.closest('.field') || sel.parentElement;
    const inp = scope.querySelector('.model-search__input');
    if (!inp) throw new Error(`search input ${id} tidak ditemukan`);
    inp.focus();
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of text) {
      inp.value += ch;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, { id, text });
  await sleep(500); // tunggu debounce + filter
}

// Pilih endpoint via providerSelect (value = id), dispatch change.
// MenUNGGU sampai switch STABIL: providerSelect.value === id DAN total model
// stabil >=2x pembacaan berurutan (hindari read-during-refresh race).
async function selectProvider(id) {
  await page.evaluate((id) => {
    const sel = document.getElementById('providerSelect');
    sel.value = id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  const start = Date.now();
  let lastTotal = null, stableCount = 0;
  while (Date.now() - start < 30000) {
    const [prov, st] = await Promise.all([
      page.evaluate(() => document.getElementById('providerSelect').value),
      page.evaluate(readState, 'modelSelect'),
    ]);
    if (prov === id && st.total >= 5) {
      if (lastTotal === null) lastTotal = st.total;
      else if (st.total === lastTotal) { stableCount++; if (stableCount >= 2) return st; }
      else lastTotal = st.total;
    }
    await sleep(300);
  }
  throw new Error(`provider ${id} tidak stabil dalam waktu yang ditentukan`);
}

// Verifikasi: setelah switch, filter pencarian LAMA sudah diRESET (input kosong).
// MENUNGGU polling sampai reset() dari refreshProviderModelList() selesai
// (berjalan async setelah fetch model), bukan sekali cek langsung.
async function assertSearchReset(id) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const cleared = await page.evaluate(({ id }) => {
      const sel = document.getElementById(id);
      const scope = sel.closest('.field') || sel.parentElement;
      const inp = scope.querySelector('.model-search__input');
      return { hasInput: Boolean(inp), empty: inp ? inp.value === '' : false };
    }, { id });
    if (cleared.hasInput && cleared.empty) return; // reset selesai
    await sleep(300);
  }
  throw new Error('filter LAMA tidak direset setelah switch endpoint');
}

// Tunggu dropdown model terisi (dipakai addCustomEndpoint). Stabil >=2x
// pembacaan berurutan agar tidak read-during-refresh.
async function waitForModelsLoaded(timeoutMs = 25000) {
  const start = Date.now();
  let lastTotal = null, stableCount = 0;
  while (Date.now() - start < timeoutMs) {
    const st = await page.evaluate(readState, 'modelSelect');
    if (st && st.total >= 5) {
      if (lastTotal === null) lastTotal = st.total;
      else if (st.total === lastTotal) { stableCount++; if (stableCount >= 2) return st; }
      else lastTotal = st.total;
    }
    await sleep(300);
  }
  throw new Error('modelSelect tidak terisi dalam waktu yang ditentukan');
}

async function dismissOnboarding() {
  for (let i = 0; i < 4; i++) {
    const closeBtn = page.locator('.modal .modal__close');
    if (await closeBtn.first().isVisible({ timeout: 400 }).catch(() => false)) { await closeBtn.first().click(); await sleep(500); continue; }
    const skip = page.locator('.modal button:has-text("Lewati")');
    if (await skip.first().isVisible({ timeout: 400 }).catch(() => false)) { await skip.first().click(); await sleep(500); continue; }
    if (await page.locator('.modal').count()) { await page.locator('.modal-overlay').click({ position: { x: 24, y: 24 }, force: true }); await sleep(600); continue; }
    return;
  }
}

// Tambahkan endpoint custom via modal "Tambah endpoint".
async function addCustomEndpoint(url, name) {
  await page.click('#addEndpointBtn');
  await sleep(500);
  const modal = page.locator('.modal').first();
  await modal.locator('#epEditUrl').fill(url);
  await modal.locator('#epEditName').fill(name);
  // Kunci API opsional; biarkan kosong.
  const saveBtn = modal.locator('button', { hasText: 'Tambah endpoint' }).last();
  await saveBtn.click({ force: true });
  await waitForModelsLoaded(25000);
}

try {
  console.log('\n== LOAD APP ==');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await sleep(800);
  await dismissOnboarding();
  await page.click('#settingsToggle');
  await sleep(500);

  // ============ ENDPOINT 1: SEED OpenRouter (via providerSelect) ============
  console.log('\n== [1] Seed: OpenRouter (providerSelect) ==');
  await selectProvider('ep-openrouter');
  await assertSearchReset('modelSelect'); // input search ada & kosong
  let st1 = await page.evaluate(readState, 'modelSelect');
  log('modelSelect after openrouter', st1);
  await typeIntoSearch('modelSelect', 'gpt');
  const gpt1 = await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const opts = Array.from(sel.options).filter((o) => !o.hidden);
    return { count: opts.length, ok: opts.every((o) => o.value.toLowerCase().includes('gpt')), sample: opts.slice(0, 4).map((o) => o.value) };
  });
  log('OpenRouter filter "gpt"', gpt1);
  await shot('01-openrouter-gpt');

  // ============ ENDPOINT 2: SEED Gemini (via providerSelect) ============
  console.log('\n== [2] Seed: Gemini AI Studio (providerSelect) ==');
  await selectProvider('ep-gemini');
  await assertSearchReset('modelSelect'); // filter "gpt" dari step 1 harus reset
  let st2 = await page.evaluate(readState, 'modelSelect');
  log('modelSelect after gemini', st2);
  await typeIntoSearch('modelSelect', 'gemini');
  const gem1 = await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const opts = Array.from(sel.options).filter((o) => !o.hidden);
    return { count: opts.length, ok: opts.every((o) => o.value.toLowerCase().includes('gemini')), sample: opts.slice(0, 4).map((o) => o.value) };
  });
  log('Gemini filter "gemini"', gem1);
  await shot('02-gemini-gemini');

  // ============ ENDPOINT 3: CUSTOM Electron Hub (via modal Tambah endpoint) ============
  console.log('\n== [3] Custom: Electron Hub (modal Tambah endpoint) ==');
  await addCustomEndpoint('https://api.electronhub.ai/v1', 'Repro Electron Hub');
  await assertSearchReset('modelSelect'); // filter "gemini" dari step 2 harus reset
  let st3 = await page.evaluate(readState, 'modelSelect');
  log('modelSelect after custom electron hub', st3);
  // Pastikan search box masih ada setelah rebuild dari endpoint custom.
  if (!st3.hasSearchInput || !st3.hasClearBtn) throw new Error('search box HILANG setelah endpoint custom!');
  await typeIntoSearch('modelSelect', 'qwen');
  const qwen1 = await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const opts = Array.from(sel.options).filter((o) => !o.hidden);
    return { count: opts.length, ok: opts.every((o) => o.value.toLowerCase().includes('qwen')), sample: opts.slice(0, 4).map((o) => o.value) };
  });
  log('Electron Hub filter "qwen"', qwen1);
  await shot('03-electronhub-qwen');

  // ============ KEMBALI KE SEED (regenerasi: search tetap utuh) ============
  console.log('\n== [4] Kembali ke OpenRouter (verifikasi search persist) ==');
  await selectProvider('ep-openrouter');
  await assertSearchReset('modelSelect'); // filter "qwen" dari step 3 harus reset
  const st4 = await page.evaluate(readState, 'modelSelect');
  log('modelSelect back to openrouter', st4);
  if (!st4.hasSearchInput || !st4.hasClearBtn) throw new Error('search box HILANG setelah switch balik!');
  await typeIntoSearch('modelSelect', 'claude');
  const claude1 = await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const opts = Array.from(sel.options).filter((o) => !o.hidden);
    return { count: opts.length, ok: opts.every((o) => o.value.toLowerCase().includes('claude')) };
  });
  log('OpenRouter filter "claude" (regenerasi)', claude1);
  await shot('04-back-openrouter-claude');

  console.log('\nSELESAI — cek screenshot di', OUT);
} catch (err) {
  console.error('[repro] ERROR:', err && err.message);
  await page.screenshot({ path: `${OUT}/ERROR.png`, fullPage: true });
} finally {
  await browser.close();
}
