// =========================================================
// BimbingKamu — verifikasi manual-search dropdown model
// (real browser, live Electron Hub). Menguji DI DUA TEMPAT:
//   1. Panel Pengaturan → #modelSelect
//   2. Modal Onboarding → #onboardModel (setelah connect)
// Jalankan: node repro-model-search.mjs
// =========================================================
import { chromium } from 'playwright-core';

const CHROME = '/Users/deddybathara/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'http://localhost:8080';
const OUT = process.env.OUT || '/tmp/repro-model-search';

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

// --- Helper DOM (dijalankan di browser) ---
const findSearch = (id) => {
  const sel = document.getElementById(id);
  if (!sel) return null;
  const scope = sel.closest('.field') || sel.parentElement;
  return scope ? scope.querySelector('.model-search__input') : null;
};
// readState sebagai FUNGSI nyata agar page.evaluate bisa meneruskan argumen (id).
const readState = (id) => {
  const sel = document.getElementById(id);
  const opts = Array.from(sel.options);
  return {
    total: opts.length,
    visible: opts.filter((o) => !o.hidden).length,
    selected: sel.value,
    badge: (sel.closest('.field') || sel.parentElement)?.querySelector('.model-search__count')?.textContent ?? null,
    firstVisible: opts.filter((o) => !o.hidden).slice(0, 6).map((o) => o.value),
  };
};

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

async function connectElectronHub(modalScope) {
  const url = 'https://api.electronhub.ai/v1';
  let modal = modalScope || page.locator('.modal').first();
  // Bila belum ada modal (mis. dari panel pengaturan), buka "Tambah endpoint".
  if (!modalScope) {
    await page.click('#addEndpointBtn');
    await sleep(500);
    modal = page.locator('.modal').first();
  }
  await modal.locator('#epEditUrl').fill(url);
  await modal.locator('#epEditName').fill('Repro Electron Hub');
  const saveBtn = modal.locator('button', { hasText: 'Tambah endpoint' }).last();
  await saveBtn.click({ force: true });
  await sleep(9000); // tunggu fetch ~599 model
}

try {
  // ============ BAGIAN 1: PANEL PENGATURAN ============
  console.log('\n== [1] Panel Pengaturan: #modelSelect ==');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await sleep(800);
  await dismissOnboarding();
  await page.click('#settingsToggle');
  await sleep(500);
  await shot('10-settings-open');

  await connectElectronHub();
  await shot('11-connected');

  // state awal sebelum search
  const pre = await page.evaluate(readState, 'modelSelect');
  log('modelSelect PRE-search', pre);

  // ketik "gpt" di input search (sibling sebelum #modelSelect)
  // verifikasi wrapper search tersusun di atas #modelSelect
  const wrap1 = await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const scope = sel.closest('.field') || sel.parentElement;
    return scope.querySelector('.model-search')?.getAttribute('class') ?? null;
  });
  console.log('  [info] wrapper search ditemukan:', wrap1);

  await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const scope = sel.closest('.field') || sel.parentElement;
    scope.querySelector('.model-search__input').focus();
  });
  // ketik manual agar event 'input' pasti keluar (debounce 100ms)
  await page.evaluate(() => {
    const inp = document.getElementById('modelSelect').closest('.field').querySelector('.model-search__input');
    inp.focus();
    inp.value = '';
    const evt = new Event('input', { bubbles: true });
    for (const ch of 'gpt') { inp.value += ch; inp.dispatchEvent(evt); }
  });
  await sleep(500);
  const gpt = await page.evaluate(readState, 'modelSelect');
  log('modelSelect after "gpt"', gpt);

  // verifikasi: semua visible mengandung 'gpt'
  const allGpt = await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const opts = Array.from(sel.options).filter((o) => !o.hidden);
    return { count: opts.length, ok: opts.every((o) => o.value.toLowerCase().includes('gpt')), sample: opts.slice(0, 6).map((o) => o.value) };
  });
  log('modelSelect filter "gpt" valid', allGpt);
  await shot('12-search-gpt');

  // clear dengan klik tombol x
  await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const scope = sel.closest('.field') || sel.parentElement;
    scope.querySelector('.model-search__clear').click();
  });
  await sleep(400);
  const cleared = await page.evaluate(readState, 'modelSelect');
  log('modelSelect after clear', cleared);
  await shot('13-cleared');

  // ============ BAGIAN 2: ONBOARDING ============
  console.log('\n== [2] Modal Onboarding: #onboardModel ==');
  // reset onboarding agar modal muncul lagi (key yang benar di config.js).
  await page.evaluate(() => localStorage.removeItem('bimbingkamu.onboardingDone'));
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(800);
  await shot('20-onboarding-reopen');

  // Onboarding step-0 = form connect. Isi + connect.
  const modal = page.locator('.modal').first();
  await modal.locator('#onboardUrl').fill('https://api.electronhub.ai/v1');
  await modal.locator('#onboardName').fill('Repro Onboard');
  const connectBtn = modal.locator('#onboardConnect');
  await connectBtn.click({ force: true });
  await sleep(9000); // tunggu model muncul
  await shot('21-onboard-connected');

  const onboardState = await page.evaluate(readState, 'onboardModel');
  log('onboardModel PRE-search', onboardState);

  // ketik "qwen" di search onboarding
  await page.evaluate(() => {
    const sel = document.getElementById('onboardModel');
    const scope = sel.closest('.field') || sel.parentElement;
    const inp = scope.querySelector('.model-search__input');
    if (!inp) throw new Error('search input onboard tidak ditemukan');
    inp.focus();
    for (const ch of 'qwen') { inp.value += ch; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(500);
  const onboardQwen = await page.evaluate(readState, 'onboardModel');
  log('onboardModel after "qwen"', onboardQwen);
  const qwenValid = await page.evaluate(() => {
    const sel = document.getElementById('onboardModel');
    const opts = Array.from(sel.options).filter((o) => !o.hidden);
    return { count: opts.length, ok: opts.every((o) => o.value.toLowerCase().includes('qwen')) };
  });
  log('onboard filter "qwen" valid', qwenValid);
  await shot('22-onboard-qwen');

  console.log('\nSELESAI — cek screenshot di', OUT);
} catch (err) {
  console.error('[repro] ERROR:', err && err.message);
  await page.screenshot({ path: `${OUT}/ERROR.png`, fullPage: true });
} finally {
  await browser.close();
}
