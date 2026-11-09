// Diagnostic: trace search input saat switch provider (OpenRouter -> Gemini).
import { chromium } from 'playwright-core';

const CHROME = '/Users/deddybathara/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'http://localhost:8080';

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const browser = await chromium.launch({ executablePath: CHROME, headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

page.on('console', (m) => console.log('  [console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

async function shot(name) { await page.screenshot({ path: `/tmp/diag/${name}.png`, fullPage: true }); }

const SKIP = '.modal button:has-text(Lewati)';

async function dismissOnboarding() {
  for (let i = 0; i < 5; i++) {
    const closeBtn = page.locator('.modal .modal__close');
    if (await closeBtn.first().isVisible({ timeout: 400 }).catch(() => false)) { await closeBtn.first().click(); await sleep(500); continue; }
    const skip = page.locator(SKIP);
    if (await skip.first().isVisible({ timeout: 400 }).catch(() => false)) { await skip.first().click(); await sleep(500); continue; }
    if (await page.locator('.modal').count()) { await page.locator('.modal-overlay').click({ position: { x: 24, y: 24 }, force: true }); await sleep(600); continue; }
    return;
  }
}

async function typeGpt() {
  await page.evaluate(() => {
    const sel = document.getElementById('modelSelect');
    const scope = sel.closest('.field') || sel.parentElement;
    const inp = scope.querySelector('.model-search__input');
    inp.focus(); inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of 'gpt') { inp.value += ch; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(500);
}

async function switchProvider(id) {
  await page.evaluate((id) => {
    const sel = document.getElementById('providerSelect');
    sel.value = id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
}

const snap = async () => page.evaluate(() => {
  const prov = document.getElementById('providerSelect').value;
  const sel = document.getElementById('modelSelect');
  const scope = sel.closest('.field') || sel.parentElement;
  const inp = scope.querySelector('.model-search__input');
  const opts = Array.from(sel.options);
  return {
    prov,
    total: opts.length,
    visible: opts.filter((o) => !o.hidden).length,
    inputVal: inp ? inp.value : 'NO-INPUT',
    hasClear: Boolean(scope.querySelector('.model-search__clear')),
    badge: scope.querySelector('.model-search__count')?.textContent ?? null,
  };
});

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('bimbingkamu.onboardingDone', true));
  await page.reload({ waitUntil: 'networkidle' }); // init ulang -> onboarding tidak muncul
  await sleep(800);
  await page.click('#settingsToggle');
  await sleep(600);

  console.log('\n-- switch to OpenRouter --');
  await switchProvider('ep-openrouter');
  await sleep(4000);
  let s = await snap(); console.log('after openrouter settle:', JSON.stringify(s));
  await shot('d1-openrouter');

  console.log('\n-- type gpt --');
  await typeGpt();
  s = await snap(); console.log('after gpt:', JSON.stringify(s));
  await shot('d2-gpt');

  console.log('\n-- switch to GEMINI --');
  await switchProvider('ep-gemini');
  const marks = [800, 1500, 3000, 5000, 8000, 12000];
  let prev = 0;
  for (const t of marks) {
    await sleep(t - prev);
    prev = t;
    s = await snap(); console.log(`t=${t}ms after gemini switch:`, JSON.stringify(s));
  }
  await shot('d3-gemini-switch');

  console.log('\nDONE');
} catch (err) {
  console.error('[diag] ERROR:', err && err.message);
  await page.screenshot({ path: '/tmp/diag/ERROR.png', fullPage: true });
} finally {
  await browser.close();
}
