// =========================================================
// BimbingKamu — LIVE APP + SERVICE WORKER reproduction (v2).
// Loads the REAL deployed app in real headed Chrome WITH its service worker
// active, seeds localStorage AFTER load then RELOADS so init() re-reads an
// ngrok provider, and captures EVERY fetch / console error / page error.
//
// Goal: reproduce the net::ERR_FAILED that persists in production AND see
// whether it lands in the direct path or the /api/proxy fallback — with the
// service worker (cache-first on /api/proxy) actually in play.
//
// Run: NGROK_BASE=... node repro-live-sw.mjs
// =========================================================
import { chromium } from 'playwright-core';

const NGROK = process.env.NGROK_BASE || 'https://oyster-regroup-neatness.ngrok-free.dev';
const APP = process.env.APP_URL || 'https://bimbingkamu.vercel.app/';
const CHROME_EXE = process.env.CHROME_EXE || '/Users/deddybathara/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const ngrokProvider = {
  id: 'ep-ng', name: 'ngrok-test', baseUrl: NGROK,
  modelsPath: '/v1/models', chatPath: '/v1/chat/completions',
  key: '', supportsGrounding: false, supportsThinking: false, custom: true,
};
const seed = {
  'bimbingkamu.onboardingDone': true,
  'bimbingkamu.settings': { provider: 'ep-ng', model: '', providers: [ngrokProvider],
    usdIdrManual: true, mode: 'konsep', level: 3, webSearch: false, tone: 'santai', starters: 'uji' },
};

const browser = await chromium.launch({ executablePath: CHROME_EXE, headless: false, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext();

const events = [];
const log = (tag, msg) => events.push({ tag, msg: String(msg).slice(0, 320) });
context.on('pageerror', (e) => log('PAGEERROR', e));
context.on('console', (m) => log(`CONSOLE:${m.type()}`, m.text()));
context.on('requestfailed', (r) => log('REQFAIL', `${r.method()} ${r.url()} -> ${(r.failure() && r.failure().errorText) || ''}`));
const responses = [];
context.on('response', (r) => responses.push({ status: r.status(), ok: r.ok(), url: r.url() }));

const page = await context.newPage();
// 1) Initial load so the SW registers + activates.
await page.goto(APP, { waitUntil: 'load', timeout: 40000 });
await page.waitForTimeout(3000);
// 2) Seed localStorage from within the page (robust), then reload so init() re-reads it.
await page.evaluate((seedArg) => {
  try {
    for (const [k, v] of Object.entries(seedArg)) localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem('bimbingkamu._seedMarker', String(Date.now()));
  } catch (e) {}
}, seed);

console.log('\n=== LIVE APP + SERVICE WORKER (real Chrome) — booting with ngrok provider ===');
console.log('app:', APP, '| ngrok:', NGROK);
await page.reload({ waitUntil: 'load', timeout: 40000 });
await page.waitForTimeout(9000);

// localStorage now.
const ls = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('bimbingkamu.')) out[k] = localStorage.getItem(k).slice(0, 240);
  }
  return out;
});
console.log('\n--- localStorage (bimbingkamu.*) ---');
for (const [k, v] of Object.entries(ls)) console.log(`  ${k} = ${v}`);

// Events.
const errs = events.filter((e) => e.tag.startsWith('CONSOLE') || e.tag === 'PAGEERROR' || e.tag === 'REQFAIL');
console.log(`\n--- EVENTS (${events.length}) ---`);
for (const e of errs) console.log(`[${e.tag}] ${e.msg}`);

// UI state.
const ui = await page.evaluate(() => {
  const model = document.querySelector('#modelSelect');
  const conn = document.querySelector('.provider-status') || document.querySelector('[class*="conn-status"]') || document.querySelector('[class*="status"]');
  return {
    modelOptions: model ? Array.from(model.options).map((o) => o.value) : 'NO #modelSelect',
    modelCount: model ? model.options.length : 0,
    connText: conn ? (conn.textContent || conn.className).slice(0, 120) : 'no conn el',
  };
});
console.log('\n--- UI STATE ---');
console.log('models in #modelSelect:', JSON.stringify(ui.modelOptions));
console.log('connection status:', ui.connText);

// Proxy + ngrok responses specifically.
const net = responses.filter((r) => r.url.includes('/api/proxy') || r.url.includes('ngrok-free.dev'));
console.log('\n--- NETWORK (proxy + ngrok) ---');
if (!net.length) console.log('  (none captured!)');
for (const r of net) console.log(`  ${r.status} ok=${r.ok}  ${r.url}`);

// SMOKING GUN: what does a raw fetch() to ngrok return THROUGH the SW?
const direct = await page.evaluate(async (ngrok) => {
  try {
    const r = await fetch(ngrok + '/v1/models');
    return { type: r.type, ok: r.ok, status: r.status, headerOK: r.headers.get('access-control-allow-origin') };
  } catch (e) {
    return { threw: true, msg: (e && e.message) || String(e) };
  }
}, NGROK);
console.log('\n--- SMOKING GUN: raw fetch() to ngrok THROUGH SW ---');
console.log(JSON.stringify(direct));

// Cache state.
const caches = await page.evaluate(async () => {
  if (!('caches' in window)) return { note: 'no caches API' };
  const keys = await caches.keys();
  const proxyEntries = [];
  for (const k of keys) {
    const c = await caches.open(k);
    const reqs = await c.keys();
    for (const rq of reqs) {
      try { if (rq.url.includes('/api/proxy')) proxyEntries.push(`${k}: ${rq.method} ${rq.url.slice(0, 150)}`); } catch {}
    }
  }
  return { keys, proxyEntries };
});
console.log('\n--- SW CACHE ---');
console.log(JSON.stringify(caches, null, 2).slice(0, 1200));

await browser.close();
console.log('\nDONE');
