// =========================================================
// BimbingKamu — INTEGRATION TEST (production logic, real browser).
// Serves REAL js/providers.js + js/api.js as browser modules and the
// REAL api/proxy/index.js handler. Page imports probeEndpoint/listModels
// from the real providers.js and calls them against REAL ngrok.
// Exercises the actual PNA -> providerFetch fallback path in headed Chrome.
// Run: NGROK_BASE=... node repro-integration.mjs
// =========================================================
import { chromium } from 'playwright-core';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const proxyModule = require('./api/proxy/index.js');
const proxyHandler = proxyModule.default || proxyModule;

const NGROK = process.env.NGROK_BASE || 'https://oyster-regroup-neatness.ngrok-free.dev';
const CHROME_EXE = process.env.CHROME_EXE || '/Users/deddybathara/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

// Minimal static server serving the REAL app modules + real proxy handler.
const read = (p) => new Promise((r, j) => require('node:fs').readFile(p, 'utf8', (e, d) => e ? j(e) : r(d)));
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  if (path === '/api/proxy') { proxyHandler(req, res).catch((e) => { try { if (!res.headersSent) res.writeHead(500); } catch {} }); return; }
  // Backend model list untuk endpoint ngrok. TIDAK mengirim header CORS agar
  // jalur LANGSUNG di browser tetap diblokir (PNA/CORS) → memaksa fallback ke
  // /api/proxy (server-side fetch), yaitu jalur PNA yang benar-benar diuji.
  if (path === '/models' || path === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: [{ id: 'ng-model', capabilities: [] }] }));
    return;
  }
  if (path === '/page') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Int</title>
    <meta http-equiv="Content-Security-Policy" content="connect-src https: http:; script-src 'self' 'unsafe-inline'"></head><body>
    <div id=out style="font:13px monospace;white-space:pre"></div>
    <script type="module">
    import { probeEndpoint, listModels } from './js/providers.js';
    window.__run = async () => {
      const out = document.getElementById('out');
      const log = (t) => { out.textContent += '\\n' + t; };
      try {
        // 1) probeEndpoint -> should find /v1/models via proxy fallback
        const probe = await probeEndpoint('${NGROK}', '');
        log('probeEndpoint -> ' + JSON.stringify(probe));
        // 2) listModels -> should return model ids via proxy fallback
        const models = await listModels('', { id:'ng', name:'ng', baseUrl:'${NGROK}', modelsPath:'/v1/models', chatPath:'/v1/chat/completions' });
        log('listModels -> ' + JSON.stringify(models));
        log('RESULT: OK');
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        log('RESULT: FAIL -> ' + msg.slice(0, 200));
      }
    };
    </script></body></html>`);
  }
  // serve real modules
  const map = { '/js/providers.js': 'js/providers.js', '/js/api.js': 'js/api.js', '/js/adapters.js': 'js/adapters.js' };
  if (map[path]) {
    try {
      const body = await read(map[path]);
      if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(body);
    } catch (e) { if (!res.headersSent) res.writeHead(500); res.end(String(e)); }
    return;
  }
  if (!res.headersSent) res.writeHead(404); res.end();
});
// PORT TETAP agar tunnel ngrok bisa menargetkan server lokal ini.
const LOCAL_PORT = 8791;
await new Promise((r) => server.listen(LOCAL_PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${LOCAL_PORT}`;

const browser = await chromium.launch({ executablePath: CHROME_EXE, headless: false, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));
page.on('console', (m) => { if (m.type()==='error' || m.type()==='warning') console.log('[CONSOLE:'+m.type()+']', m.text()); });
page.on('requestfailed', (r) => console.log('[REQFAIL]', r.url(), r.failure() ? r.failure().errorText : ''));
await context.addInitScript(()=>{try{localStorage.setItem('bimbingkamu.onboardingDone','true');}catch{}});
await page.goto(BASE + '/page', { waitUntil: 'load', timeout: 30000 });
console.log('__run defined?', await page.evaluate(() => typeof window.__run));
console.log('__run defined?', await page.evaluate(() => typeof window.__run));
await page.evaluate(async () => { if (typeof window.__run !== 'function') throw new Error('__run not defined'); await window.__run(); });
await page.waitForTimeout(3000);

console.log(`\n=== INTEGRATION TEST (real providers.js -> real /api/proxy -> real ngrok) ===`);
console.log('ngrok:', NGROK);
console.log(await page.evaluate(() => document.getElementById('out').textContent));

await server.close();await browser.close();
console.log('\nDONE');
