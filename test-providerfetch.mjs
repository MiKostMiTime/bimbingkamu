// =========================================================
// BimbingKamu — providerFetch fallback unit test (real providers.js).
// Memoksid global.fetch untuk mensimulasikan 4 pola jalur langsung:
//   ok      -> respons cepat (pemenang race, TIDAK proksi)
//   opaque  -> respons status 0 / type 'opaque' -> proksi
//   throw   -> mempar error -> proksi
//   hang    -> TIDAK pernah balas -> proksi setelah ~12s (TIMEOUT/race)
// Jalan: node test-providerfetch.mjs
// =========================================================
import { providerFetch } from './js/providers.js';

const NGROK = 'https://oyster-regroup-neatness.ngrok-free.dev/v1/models';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeOpaqueResponse() {
  const r = new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
  Object.defineProperty(r, 'status', { get: () => 0 });
  Object.defineProperty(r, 'type', { get: () => 'opaque' });
  return r;
}

// Mock global.fetch: route ke proksi (url含 /api/proxy) atau jalur langsung.
function installFetch(cfg) {
  return async (url) => {
    const u = typeof url === 'string' ? url : url.href;
    if (u.includes('/api/proxy')) {
      cfg.proxyCalls++;
      return new Response(JSON.stringify({
        status: 200, ok: true, proxyStatus: 'ok',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: [{ id: 'model-via-proxy', capabilities: ['chat/completions'] }] }),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    cfg.directCalls++;
    if (cfg.mode === 'ok') { await sleep(cfg.delay); return new Response(JSON.stringify({ data: [{ id: 'model-direct' }] }), { status: 200 }); }
    if (cfg.mode === 'opaque') { await sleep(cfg.delay); return makeOpaqueResponse(); }
    if (cfg.mode === 'throw') { await sleep(cfg.delay); throw new TypeError('Failed to fetch'); }
    if (cfg.mode === 'hang') { return new Promise(() => {}); } // tak pernah balas
    throw new Error('mode unknown: ' + cfg.mode);
  };
}

async function run(mode, { expectProxy, maxMs }) {
  const cfg = { mode, delay: 500, directCalls: 0, proxyCalls: 0 };
  const fetchMock = installFetch(cfg);
  globalThis.fetch = fetchMock;
  const t0 = Date.now();
  let result, err;
  try {
    const res = await providerFetch(NGROK, {});
    const data = await res.json();
    result = data.data[0].id;
  } catch (e) { err = e; }
  const ms = Date.now() - t0;
  const okProxy = expectProxy ? cfg.proxyCalls === 1 : cfg.proxyCalls === 0;
  const withinTime = maxMs ? ms <= maxMs : true;
  const pass = okProxy && withinTime && !err;
  console.log(`${pass ? 'PASS' : 'FAIL'} | mode=${mode.padEnd(7)} direct=${cfg.directCalls} proxy=${cfg.proxyCalls} result=${result ?? '-'} err=${err ? err.message.slice(0,40) : '-'} ${ms}ms`);
  return pass;
}

const results = [];
results.push(await run('ok',      { expectProxy: false, maxMs: 3000 }));
results.push(await run('opaque',  { expectProxy: true,  maxMs: 3000 }));
results.push(await run('throw',   { expectProxy: true,  maxMs: 3000 }));
results.push(await run('hang',    { expectProxy: true,  maxMs: 16000 })); // kunci: >12s -> proksi via race

console.log(`\n${results.every(Boolean) ? 'ALL PASS ✅' : 'SOME FAIL ❌'} (${results.filter(Boolean).length}/${results.length})`);
process.exit(results.every(Boolean) ? 0 : 1);
