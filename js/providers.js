// =========================================================
// BimbingKamu — REGISTRY PROVIDER + listModels
// Registry provider [OI]-compatible: TANPA provider bawaan.
// Semua endpoint ditambahkan user (mis. http://127.0.0.1:1234);
// daftar model SELALU diambil dari endpoint itu sendiri, sehingga
// tidak ada model hardcode yang bisa menimbulkan error.
// Murni modul (tanpa DOM); error dari fetch dipeta ke mapApiError.
// =========================================================
import { mapApiError, extractSources } from './api.js';

// ===== PROXY & providerFetch (PNA/CORS) =====
// Masalah: aplikasi dijalankan sebagai halaman HTTPS di Vercel. Bila endpoint
// ditambahkan user berupa tunnel publik (mis. ngrok: https://....ngrok-free.dev),
// browser mengirim OPTIONS preflight PNA; server membalas 200 + Access-Control-
// Allow-Origin:* TAPI tanpa Access-Control-Allow-Private-Network → Chrome menolak
// respons dengan net::ERR_FAILED (fetch melempar TypeError "Failed to fetch").
// Endpoint lokal (same-network) tidak terkena PNA, jadi tetap jalan langsung.
//
// Solusi: providerFetch() coba fetch LANGSUNG dulu; bila gagal → fallback ke
// proksi same-origin /api/proxy (Vercel). Proksi melakukan fetch dari SISI SERVER
// (bebas CORS + PNA) lalu mengembalikan envelope JSON {status,ok,headers,body}
// yang dibungkus menjadi Response agar caller (.json()/.text()/.body) tetap jalan.
// Ini membuat endpoint publik/ngrok bekerja TANPA ekstensi & TANPA user harus
// mengaktifkan ACPNT/CORS di tunnel-nya; lokal tetap lewat jalur langsung (cepat).
const PROXY_PATH = '/api/proxy';

// ===== TUNNEL PUBLIK (ngrok/localtunnel) =====
// Tunnel gratis menampilkan halaman peringatan HTML kepada permintaan yang
// datang dari browser. Halaman itu TIDAK membawa header CORS, sehingga fetch
// gagal (net::ERR_FAILED / TypeError) walau endpoint di baliknya sehat dan
// header CORS-nya benar. Tunnel menyediakan header khusus untuk melewati
// halaman itu; kirim hanya ke host tunnel agar endpoint biasa tidak terkena
// preflight tambahan.
const NGROK_HOST_RE = /(^|\.)ngrok(-free)?\.(app|dev|io|pizza|pro|page)$/i;
const LOCALTUNNEL_HOST_RE = /(^|\.)loca\.lt$/i;

function tunnelBypassHeaders(targetUrl) {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    if (NGROK_HOST_RE.test(host)) return { 'ngrok-skip-browser-warning': 'bimbingkamu' };
    if (LOCALTUNNEL_HOST_RE.test(host)) return { 'bypass-tunnel-reminder': 'bimbingkamu' };
  } catch {}
  return {};
}

function withTunnelHeaders(targetUrl, headers) {
  const extra = tunnelBypassHeaders(targetUrl);
  if (!Object.keys(extra).length) return headers;
  const merged = new Headers(headers || {});
  for (const [k, v] of Object.entries(extra)) merged.set(k, v);
  return merged;
}

// Timeout internal untuk jalur langsung providerFetch (~12 detik). Bila fetch
// LANGSUNG ke endpoint publik (ngrok) TIDAK membalas dalam batas ini — pola
// hang PNA/CORS + service worker aktif di mobile Chromium — kita batakan lalu
// fallback ke /api/proxy. Lokal (same-network) biasanya merespons jauh lebih
// cepat, jadi tak pernah menyentuh batas ini.
const DEFAULT_DIRECT_TIMEOUT_MS = 12000;

// ===== DIAGNOSTIK FETCH (PNA/CORS) =====
// Catat setiap keputusan providerFetch ke localStorage agar bisa dibaca ulang
// di perangkat — console mobile sering hilang saat error. Format: array
// { t, k:kind, d:detail }. Baca dengan:
//   JSON.parse(localStorage.getItem('bimbingkamu._fetchLog') || '[]')
const FETCH_LOG_KEY = 'bimbingkamu._fetchLog';
const FETCH_LOG_MAX = 40;
function logFetch(kind, detail = '') {
  try {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(FETCH_LOG_KEY) || '[]'); } catch {}
    if (!Array.isArray(arr)) arr = [];
    arr.push({ t: Date.now(), k: kind, d: String(detail).slice(0, 240) });
    if (arr.length > FETCH_LOG_MAX) arr = arr.slice(-FETCH_LOG_MAX);
    localStorage.setItem(FETCH_LOG_KEY, JSON.stringify(arr));
  } catch {}
}

function headersToPairs(headers) {
  const out = [];
  if (!headers) return out;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((v, k) => out.push([k, v]));
  } else if (Array.isArray(headers)) {
    for (const pair of headers) {
      if (Array.isArray(pair) && pair.length >= 2) out.push([String(pair[0]), String(pair[1])]);
    }
  } else if (typeof headers.forEach === 'function') {
    headers.forEach((v, k) => out.push([k, v]));
  } else if (typeof headers === 'object') {
    // Header dari providers.js berupa objek biasa ({ 'Content-Type': ...,
    // Authorization: ... }); dulu objek ini jatuh ke forEach yang tidak ada →
    // header hilang saat lewat proksi (endpoint membalas 415/401).
    for (const k of Object.keys(headers)) out.push([k, String(headers[k])]);
  }
  return out;
}

async function proxyFetch(targetUrl, init = {}) {
  const headers = withTunnelHeaders(targetUrl, init.headers);
  const envelope = {
    url: targetUrl,
    method: init.method || 'GET',
    headers: headersToPairs(headers),
  };
  if (init.body != null) {
    envelope.body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  }
  // POST ke proksi same-origin: body chat + materi bisa puluhan KB dan TIDAK
  // muat di query string GET (Vercel membalas 414). Server /api/proxy membaca
  // envelope JSON ini dari body request.
  const res = await fetch(PROXY_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(envelope),
    signal: init.signal,
  });
  if (!res.ok) throw { type: 'network', message: 'Proksi endpoint gagal memanggil target.' };

  // Proksi kini membalas dalam 2 mode: (a) stream mentah text/event-stream untuk
  // chat streaming (passthrough → readSSE), atau (b) envelope JSON untuk
  // non-stream (GET /models). Deteksi dari content-type agar stream mengalir live.
  const ct = typeof res.headers.get === 'function' ? (res.headers.get('content-type') || '') : '';
  if (/text\/event-stream|application\/x-ndjson/i.test(ct)) {
    return res; // stream mentah: lewatkan utuh ke chatCompletion → readSSE
  }

  let env; try { env = await res.json(); } catch { env = {}; }
  const bodyText = env.body != null ? env.body : '';
  return new Response(bodyText, {
    status: env.status || (env.ok ? 200 : 0),
    statusText: env.ok ? 'OK' : 'Proxy',
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// Fetch provider: coba langsung; bila TIDAK sukses → fallback ke /api/proxy.
// Lokal (same-network) lewat jalur langsung (cepat). Fallback terpicu bila:
//   1. THROW     : fetch LANGSUNG mempar error (PNA/CORS — Safari/desktop).
//   2. OPAQUE    : mobile Chromium mengembalikan Response opaque (status 0 /
//                  type 'opaque') tanpa mempar error.
//   3. TIMEOUT   : fetch LANGSUNG belum selesai ~12s. Dipakai RACE dengan timer
//                  agar fallback jalan TANPA bergantung abort() membuat fetch
//                  langsung reject — pola yang tak andal di mobile Chromium
//                  (di sini fetch bisa tetap "hidup" walau sudah dibatalkan).
// init.signal pemanggil (tombol Berhenti) tetap hormati: dicerminkan ke timer
// dan dipakai juga di jalur proksi.
export async function providerFetch(targetUrl, init = {}, opts = {}) {
  // Base URL lama yang tersimpan tanpa skema harus tetap bisa dipakai; tanpa
  // ini fetch memperlakukannya sebagai path relatif ke aplikasi.
  if (typeof targetUrl === 'string') targetUrl = normalizeEndpointUrl(targetUrl);
  const callerSignal = init.signal || null;
  const acDirect = new AbortController();
  // Timeout jalur langsung bisa diganti per-panggilan (utk uji); default 12s.
  const DIRECT_TIMEOUT_MS = opts.timeoutMs ?? DEFAULT_DIRECT_TIMEOUT_MS;

  // Cermin pembatalan pemanggil (tombol Berhenti) ke controller langsung.
  function onCallerAbort() {
    if (!acDirect.signal.aborted) acDirect.abort();
  }
  if (callerSignal) {
    if (callerSignal.aborted) acDirect.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let settled = false;
  let timer;
  const cleanup = () => {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  };

  // RACE TANPA undefined: pemenang mencatat Response final ke winnerGate SETELAH
  // nilai siap, sehingga cabang yang kalah (settled===true) menunggu gate →
  // Promise.race TIDAK PERNAK mengembalikan undefined (fix: .ok pada undefined).
  let resolveWinner = () => {};
  const winnerGate = new Promise((resolve) => { resolveWinner = resolve; });

  // Tandai pemenang PERTAMA: jalankan cleanup + hentikan fetch latar belakang.
  // keepBodySignal: bila jalur LANGSUNG menang dengan Response yang body-nya akan
  // dibaca pemanggil (listModels/chatCompletion), signal TIDAK dibatalkan agar
  // res.json()/readSSE() bisa membaca body. Browser/undici mengikat body stream
  // ke signal fetch → abort di sela header-body membuat body read melempar
  // AbortError mentah (bug: semua model gagal dimuat). Bila jalur LAIN yang menang
  // (timer / opaque / threw), direct masih menggantung/terbangun → tetap dibatalkan.
  function markWon(keepBodySignal = false) {
    if (settled) return false;
    settled = true;
    cleanup();
    if (!keepBodySignal) acDirect.abort();
    return true;
  }

  // Fallback proksi — jalur andal untuk endpoint remote (bebas CORS + PNA).
  // CATATAN: setiap kali proksi dipakai (opaque / threw / timeout) lewat sini,
  // jadi titik tunggal untuk mencatat viaProxy → dipakai cascade retry agar tak
  // re-race direct→proxy berulang di endpoint remote.
  async function toProxy() {
    if (typeof opts.onViaProxy === 'function') opts.onViaProxy();
    logFetch('proxy', `→ ${targetUrl}`);
    try {
      const res = await proxyFetch(targetUrl, init);
      logFetch('proxy-ok', `${res.status} type=${res.type} ok=${res.ok}`);
      return res;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      logFetch('proxy-threw', msg.slice(0, 240));
      throw e;
    }
  }

  // Jalur langsung: menang bila selesai lebih dulu dari timer. Bila opaque /
  // status 0 / mempar error → proksi (hanya bila timer belum menang).
  // Header bypass tunnel (ngrok/localtunnel) membuat jalur langsung tetap
  // berfungsi di mobile: tanpa header ini browser menerima halaman peringatan
  // HTML tanpa CORS dan fetch selalu gagal sebelum sempat ke proksi.
  const directInit = {
    ...init,
    signal: acDirect.signal,
    headers: withTunnelHeaders(targetUrl, init.headers),
  };
  const direct = fetch(targetUrl, directInit)
    .then(async (res) => {
      if (settled) return winnerGate; // kalah: tunggu pemenang mencatat result
      if (res.type === 'opaque' || res.status === 0) {
        logFetch('opaque', `status=${res.status} type=${res.type}`);
        markWon();                       // menang → proksi (latar dibatalkan)
        const proxyRes = await toProxy();
        resolveWinner(proxyRes);         // buka gate → tak pernah undefined
        return proxyRes;
      }
      logFetch('direct-ok', `status=${res.status} type=${res.type} ok=${res.ok}`);
      markWon(true);                       // menang → pertahankan signal agar body bisa dibaca pemanggil
      resolveWinner(res);                // buka gate → tak pernah undefined
      return res;
    })
    .catch(async () => {
      if (settled) return winnerGate;    // kalah: tunggu pemenang mencatat result
      logFetch('direct-threw', 'fetch LANGSUNG mempar error → proksi');
      markWon();                         // menang → proksi
      const proxyRes = await toProxy();
      resolveWinner(proxyRes);           // buka gate → tak pernah undefined
      return proxyRes;
    });

  // Timer: bila langsung belum selesai ~12s → proksi SEGERA (tanpa menunggu
  // fetch langsung reject). Race menang yang lebih dulu settle.
  const timedFallback = new Promise((resolve, reject) => {
    timer = setTimeout(async () => {
      if (settled) return winnerGate; // kalah: pemenang lain sudah menang
      logFetch('timeout', `langsung >${DIRECT_TIMEOUT_MS}ms → proksi`);
      markWon();                       // menang → hentikan fetch latar
      let v;
      try { v = await toProxy(); } catch (e) { reject(e); return; }
      resolveWinner(v);                // buka gate → yang kalah dapat v
      resolve(v);
    }, DIRECT_TIMEOUT_MS);
  });

  return Promise.race([direct, timedFallback]);
}

// Registry bawaan KOSONG — provider hanya ada bila user menambahkannya
// via probeEndpoint (onboarding / drawer Pengaturan).
export const PROVIDERS = {};

// Provider BAWAAN yang langsung muncul di dropdown saat peluncuran pertama,
// agar fresh user tidak melihat "Belum ada endpoint". Shape-nya sama persis
// dengan custom provider dari connectEndpoint (L240–251): id + baseUrl wajib,
// modelsPath/chatPath untuk listModels & buildChatRequest, supportsGrounding /
// supportsThinking untuk tools & thinkingLevel, custom:false agar setting
// tersimpan stabil antar reload. Dynamic pricing tetap jalan: OpenRouter
// terdeteksi otomatis (live), OpenAI/Gemini → null (UI tampilkan token tanpa
// biaya). Id stabil + custom:false → migrateLegacyProviderSettings tidak
// menyentuh seed.
export const DEFAULT_PROVIDERS = {
  'ep-openrouter': {
    id: 'ep-openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    supportsGrounding: true, // websearch → tools pencarian (semua provider bisa)
    supportsThinking: true,
    custom: false,
  },
  'ep-gemini': {
    id: 'ep-gemini',
    name: 'Gemini AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    supportsGrounding: true, // webSearch → tools google_search
    supportsThinking: true,
    custom: false,
  },
  'ep-openai': {
    id: 'ep-openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    supportsGrounding: true, // websearch → tools pencarian (semua provider bisa)
    supportsThinking: true,
    custom: false,
  },
};

// Registry = seed (DEFAULT_PROVIDERS) + custom dari settings.providers. Seed
// dimasukkan duluan agar dropdown tidak kosong saat peluncuran pertama;
// custom menimpa bila id-nya sama dan diberi flag custom.
export function resolveProviders(custom = []) {
  const all = { ...PROVIDERS, ...DEFAULT_PROVIDERS };
  for (const p of custom) {
    if (!p || !p.id) continue;
    // Endpoint bawaan yang "dihapus" user disimpan sebagai override
    // { id, baseUrl, hidden: true } → jangan tampilkan lagi.
    if (p.hidden) {
      delete all[p.id];
      continue;
    }
    if (p.baseUrl) all[p.id] = { ...p, baseUrl: normalizeEndpointUrl(p.baseUrl), custom: true };
  }
  return all;
}

// ===== CRUD PROVIDER CUSTOM (murni, array → array) =====
// Dipakai drawer Pengaturan untuk menambah/menyunting/hapus endpoint. Semua
// fungsi murni (stateless): terima array provider, kembalikan array baru tanpa
// memodifikasi input. state.settings.providers di app.js yang menyimpan hasil.
export function addProvider(providers, provider) {
  return [...providers, provider];
}

export function updateProvider(providers, id, patch) {
  return providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

// Hapus endpoint dari daftar settings. Endpoint bawaan (seed) tidak bisa
// benar-benar hilang dari registry, jadi disimpan sebagai override
// { hidden: true } dengan id yang sama; resolveProviders akan menyaringnya.
export function removeProvider(providers, id, defaults = DEFAULT_PROVIDERS) {
  const seed = defaults[id];
  if (!seed) return providers.filter((p) => p.id !== id);
  const existing = providers.find((p) => p.id === id);
  if (existing) return updateProvider(providers, id, { hidden: true });
  return [...providers, { ...seed, id, baseUrl: seed.baseUrl, hidden: true }];
}

// Pilih provider aktif baru setelah satu endpoint dihapus: tetap pada yang
// aktif bila masih ada; bila dihapus → endpoint pertama tersisa; bila habis → ''.
export function nextActiveAfterDelete(providers, activeId, deletedId) {
  const remaining = providers.filter((p) => p.id !== deletedId);
  return remaining.some((p) => p.id === activeId) ? activeId : (remaining[0]?.id || '');
}

// ===== PRESDENSI KUNCI PER-ENDPOINT (murni) =====
// Kunci endpoint menang; bila kosong → fallback kunci umum (legacy); bila tak
// ada apa-apa → ''. Wrapper app.js: resolveApiKey(currentProviders(), id, apiKey).
export function resolveApiKey(providers, activeId, legacyKey) {
  const p = providers[activeId];
  return (p && p.key) || legacyKey || '';
}

// Header otentikasi: kunci kosong → TANPA header auth (endpoint lokal
// seperti LM Studio/Ollama tidak butuh). Kunci terisi → Bearer.
function authHeader(apiKey) {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

// ===== NORMALISASI BASE URL =====
// User sering menempel domain tanpa skema (mis. "api.electronhub.ai/v1").
// fetch() memperlakukan string seperti itu sebagai path RELATIF ke aplikasi —
// bukan host tujuan — sehingga probe/chat gagal walau endpoint sehat. Tambahkan
// skema: host lokal/LAN → http, host publik → https.
// Normalisasi skema + host lowercase + rapatkan slash ganda di path agar
// chatPath yang ditempel afterward tidak jadi ".../v1//chat/completions".
function normalizeUrlCaseAndSlashes(base) {
  try {
    const u = new URL(base);
    const scheme = u.protocol.replace(/:$/, '').toLowerCase();
    const host = u.host.toLowerCase();
    const pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return `${scheme}://${host}${pathname}${u.search}${u.hash}`;
  } catch {
    return base.replace(/\/+$/, '');
  }
}
// Host lokal/LAN = target pakai skema http:// (bukan https://). Dipakai
// normalizeEndpointUrl() untuk memilih skema, DAN probeEndpoint() agar error
// Mixed Content di endpoint lokal diberi panduan SPESIFIK (tunnel HTTPS /
// ekstensi bridge), bukan pesan jaringan generik yang membingungkan.
export function isLocalHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h === '[::1]' || h === '::1' ||
    h === 'host.docker.internal' || h.endsWith('.local') ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) ||
    /^[a-z0-9-]+$/i.test(h);
}

export function normalizeEndpointUrl(baseUrl) {
  let base = String(baseUrl || '').trim();
  if (!base) return '';
  if (base.startsWith('//')) base = `https:${base}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    // Path relatif (diawali satu "/") bukan base URL endpoint; biarkan apa
    // adanya agar fetch gagal dengan pesan yang jelas, bukan diubah jadi host.
    if (/^\/(?!\/)/.test(base)) return base.replace(/\/+$/, '');
    const authority = base.split('/')[0];
    const host = authority
      .replace(/^\[([^\]]+)\](?::\d+)?$/, '[$1]')
      .replace(/:\d+$/, '')
      .toLowerCase();
    const isLocal = isLocalHost(host);
    base = `${isLocal ? 'http' : 'https'}://${base}`;
  }
  return normalizeUrlCaseAndSlashes(base);
}

// Gabung baseUrl + path relatif (modelsPath/chatPath) menjadi URL lengkap.
// Berbeda dengan concat sederhana `${baseUrl}${path}` yang bisa DOBEL segmen
// (mis. base .../v1 + modelsPath /v1/models -> .../v1/**v1**/models → 403),
// fungsi ini RAPATKAN slash ganda DAN HAPUS segmen path duplikat berurutan
// (/v1/v1 -> /v1). Scheme + host dipertahankan via URL. Untuk provider tanpa
// dobel segmen (OpenRouter/Gemini/OpenAI) hasilnya identik dengan concat lama
// → no-op, tak ada regress. Dipakai listModels + buildChatRequest agar daftar
// model & chat selalu ke path yang benar walau modelsPath tersimpan dobel.
export function joinProviderPath(baseUrl, relPath) {
  const base = normalizeEndpointUrl(baseUrl);
  let path = String(relPath || '');
  if (!path.startsWith('/')) path = `/${path}`;
  try {
    const u = new URL(base);
    const segs = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
      .concat(path.split('/').filter(Boolean));
    const out = [];
    for (const s of segs) {
      if (out.length && out[out.length - 1] === s) continue; // hapus duplikat berurutan
      out.push(s);
    }
    u.pathname = `/${out.join('/')}`;
    return u.toString();
  } catch {
    // Fallback bila base tak valid: concat + rapatkan slash.
    return `${base.replace(/\/+$/, '')}${path.replace(/\/{2,}/g, '/')}`;
  }
}

// Halaman aplikasi/dashboard (app.*, www.*) sering bukan API.
// pemisahan yang umum ini, API biasanya ada di api.<domain>. Hanya dipakai
// saat URL yang dimasukkan benar-benar membalas HTML (bukan API), dan hanya
// root host yang dicoba agar path dashboard tidak ikut terbawa.
function apiHostVariant(base) {
  try {
    const u = new URL(base);
    if (!/^(app|www)\./i.test(u.hostname)) return null;
    u.hostname = u.hostname.replace(/^[^.]+\./, 'api.');
    u.pathname = '/';
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

// Deteksi respons HTML tanpa bergantung pada Content-Type: proksi same-origin
// membungkus semua respons sebagai application/json, jadi body ikut diperiksa.
function looksLikeHtml(res, text) {
  try {
    const ct = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : '';
    if (/text\/html/i.test(ct || '')) return true;
  } catch {}
  return /^\s*<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(String(text || '').slice(0, 240));
}

function htmlPageError(base) {
  const alt = apiHostVariant(base);
  const hint = alt
    ? ` Coba base URL API: ${alt}.`
    : ' Gunakan base URL API dari penyedianya (biasanya berakhiran /v1), bukan alamat aplikasi/dashboard.';
  return {
    type: 'badrequest',
    message: `URL ini membuka halaman web (HTML), bukan API model.${hint}`,
  };
}

// ===== PROBE ENDPOINT (baru) =====
// Verifikasi Base URL saat ditambahkan: coba GET {base}/models lalu
// {base}/v1/models — simpan path yang hidup supaya chat nanti tidak
// menebak-nebak. Return { baseUrl, modelsPath, chatPath }; gagal keduanya →
// throw error ramah. Header auth hanya dikirim bila kunci diisi.
export async function probeEndpoint(baseUrl, apiKey = '') {
  const base = normalizeEndpointUrl(baseUrl);
  if (!base) {
    throw { type: 'badrequest', message: 'Masukkan URL endpoint dulu, ya.' };
  }
  // Host lokal/LAN (http://) rawan Mixed Content di halaman HTTPS: fetch
  // LANGSUNG diblokir browser dan proksi cloud Vercel tak jangkau
  // localhost/IP-private. Tandai agar error-nya diberi panduan khusus.
  let hostLocal = false;
  try { hostLocal = isLocalHost(new URL(base).hostname); } catch { hostLocal = false; }
  const candidates = ['/models', '/v1/models'];
  const bases = [base];
  const alt = apiHostVariant(base);
  if (alt && alt !== base) bases.push(alt);

  let lastErr = null;
  let htmlErr = null;
  for (let bi = 0; bi < bases.length; bi++) {
    const candidateBase = bases[bi];
    let htmlCount = 0;
    for (const modelsPath of candidates) {
      let res;
      try {
        res = await providerFetch(`${candidateBase}${modelsPath}`, { headers: authHeader(apiKey) });
      } catch {
        // Browser melempar TypeError tanpa detail saat: offline, URL salah,
        // ATAU respons diblokir CORS (server tidak mengirim
        // Access-Control-Allow-Origin). Sebut keduanya di pesan.
        lastErr = {
          type: 'network',
          message:
            'Tidak bisa terhubung ke endpoint. Periksa URL & koneksi. Bila diakses dari perangkat lain, pastikan server aktif dan CORS diaktifkan.',
        };
        continue; // coba kandidat berikutnya
      }
      // Baca body SEKALI sebagai teks: status 200 tidak cukup (LM Studio
      // menjawab GET /models dengan 200 + {"error": ...}) dan halaman HTML
      // (dashboard/Cloudflare) harus dikenali, bukan dilaporkan sebagai
      // "model tidak tersedia".
      let bodyText = '';
      try { bodyText = await res.text(); } catch {}
      if (looksLikeHtml(res, bodyText)) {
        htmlCount++;
        lastErr = htmlPageError(base);
        continue; // coba kandidat berikutnya
      }
      if (res.ok) {
        let data = null;
        try { data = JSON.parse(bodyText); } catch { data = null; }
        if (data && !data.error && Array.isArray(data.data)) {
          // chatPath disimpulkan dari modelsPath yang hidup.
          const chatPath = modelsPath.replace(/\/models$/, '/chat/completions');
          return { baseUrl: candidateBase, modelsPath, chatPath };
        }
        lastErr = {
          type: 'badrequest',
          message: `${modelsPath} merespons tapi bukan daftar model. Coba URL lain (mis. .../v1).`,
        };
        continue; // coba kandidat berikutnya
      }
      // Baca body error: LM Studio/Gemini mengirim alasan yang spesifik
      // (mis. "an LM Studio API token is required"). Tanpa ini pengguna hanya
      // melihat pesan auth generik dan tidak tahu token harus dibuat di mana.
      if (res.status === 404) {
        // 404 saat probe = path/base URL salah, BUKAN model tidak tersedia.
        lastErr = {
          type: 'badrequest',
          message: `${modelsPath} tidak ditemukan di endpoint (404). Periksa base URL — biasanya berakhiran /v1.`,
        };
        continue;
      }
      lastErr = { ...mapApiError(res.status, bodyText.slice(0, 800)) };
    }
    // Hanya coba api.<domain> bila SEMUA kandidat di host asli membalas HTML
    // (artinya host itu halaman aplikasi, bukan API). Bila ada respons API
    // sungguhan — termasuk 401 — jangan berpindah host.
    if (bi === 0) {
      htmlErr = htmlCount === candidates.length ? lastErr : null;
      if (!htmlErr) break;
    }
  }
  // Bila host api.* ada tapi menolak kunci, error auth lebih berguna daripada
  // "ini halaman web". Selain itu tampilkan error HTML + saran URL API.
  if (htmlErr && lastErr && lastErr.type === 'auth') throw lastErr;

  // Endpoint lokal/LAN (http://): di halaman HTTPS, fetch LANGSUNG diblokir
  // Mixed Content dan proksi cloud tak jangkau localhost/IP-private. Beri
  // panduan SPESIFIK (tunnel HTTPS / ekstensi bridge), bukan pesan jaringan
  // generik. Hanya saat kegagalan JARINGAN (bukan dashboard/HTML atau auth).
  if (hostLocal && lastErr && lastErr.type === 'network') {
    throw {
      type: 'local',
      message:
        'Endpoint lokal (http://...) tidak bisa dibuka langsung dari halaman HTTPS karena browser memblokir "mixed content" (sumber HTTP). 1) Tunnel HTTPS — jalankan ngrok http 1234 atau cloudflared tunnel --url http://localhost:1234 di komputer, lalu tempel URL HTTPS yang muncul sebagai Base URL. 2) Ekstensi Chrome — pasang "BimbingKamu - LM Studio Bridge" untuk koneksi langsung ke local/LAN tanpa terminal.',
    };
  }

  throw htmlErr || lastErr || {
    type: 'badrequest',
    message: 'Endpoint tidak merespons /models maupun /v1/models. Periksa URL-nya.',
  };
}

// ===== CONTEXT LIMIT (LM Studio /api/v0) =====
// API [OI]-compat standar tidak melaporkan context window. LM Studio
// menyediakannya lewat REST /api/v0/models (field max_context_length).
// Bila endpoint bukan LM Studio → return null (UI menampilkan tanda "-").
export async function fetchContextLimit(provider, apiKey, model) {
  if (!provider || !provider.baseUrl || !model) return null;
  try {
    // providerFetch → fallback ke /api/proxy bila fetch LANGSUNG gagal (PNA/CORS
    // untuk endpoint remote/ngrok). Tanpa ini, endpoint publik tetap net::ERR_FAILED.
    const res = await providerFetch(`${provider.baseUrl}/api/v0/models`, { headers: authHeader(apiKey) });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data.data) ? data.data : [];
    const found = list.find((m) => m && (m.id === model || String(m.id || '').endsWith(`/${model}`)));
    const n = found && Number(found.max_context_length);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null; // endpoint lain / offline → bukan masalah, hanya tanpa info
  }
}

// ===== HARGA MODEL (DINAMIS, tanpa hardcode) =====
// Harga model AMBIL dari provider-nya sendiri, jadi selalu menyesuaikan
// endpoint yang dipakai — TANPA input manual:
//   1. LM Studio /api/v0/models → model lokal → Rp0 (gratis, tidak berbayar).
//   2. OpenRouter (baseUrl mengandung openrouter.ai) → GET /api/v1/models
//      live pricing dari endpoint itu sendiri.
// Selain itu → null (UI menampilkan token tanpa biaya).
export async function fetchModelPricing(provider, apiKey, model) {
  if (!provider || !provider.baseUrl || !model) return null;
  // 1) LM Studio → endpoint lokal, model gratis.
  const isLMStudio = await probeLMStudio(provider, apiKey);
  if (isLMStudio) return { input: 0, output: 0, source: 'local' };
  // 3) OpenRouter → live pricing dari endpoint-nya.
  if (/openrouter\.ai/i.test(provider.baseUrl)) {
    try {
      const res = await providerFetch('https://openrouter.ai/api/v1/models', { headers: authHeader(apiKey) });
      if (res.ok) {
        const data = await res.json();
        const found = (data.data || []).find((m) => m && (m.id === model || String(m.id || '').endsWith(`/${model}`)));
        const pr = found && found.pricing;
        if (pr && pr.prompt != null && pr.completion != null) {
          // OpenRouter pakai USD per TOKEN → kali 1e6 jadi per 1M token.
          return { input: +pr.prompt * 1e6, output: +pr.completion * 1e6, source: 'openrouter' };
        }
      }
    } catch {}
  }
  return null;
}

// Deteksi LM Studio: /api/v0/models merespons ok → endpoint lokal.
async function probeLMStudio(provider, apiKey) {
  try {
    const res = await providerFetch(`${provider.baseUrl}/api/v0/models`, { headers: authHeader(apiKey) });
    return res.ok;
  } catch {
    return false;
  }
}

// Ambil daftar ID model chat-capable dari endpoint provider.
// GET ${baseUrl}${modelsPath} → filter model yang bisa chat, dedup per id.
// Id model dari respons /models endpoint (pemilik endpoint bisa mengontrol
// isinya). Disair lewat whitelist karakter agar aman disisipkan ke <option>
// tanpa escape — karakter yang tersisa [A-Za-z0-9._/-] tidak ada yang spesial
// untuk HTML, jadi tak bisa tembus XSS. Dipakai di dropdown model (app.js) dan
// onboarding (ui.js), keduanya mengambil hasil fungsi ini.
export function sanitizeModelId(id) {
  return String(id ?? '').replace(/[^A-Za-z0-9._/-]/g, '');
}

export async function listModels(apiKey, provider, opts = {}) {
  if (!provider || !provider.baseUrl) {
    throw { type: 'badrequest', message: 'Endpoint belum terdaftar. Tambahkan endpoint dulu.' };
  }
  let res;
  try {
    res = await providerFetch(joinProviderPath(provider.baseUrl, provider.modelsPath), { headers: authHeader(apiKey) }, opts);
  } catch {
    // fetch melempar saat offline / jaringan terputus → error network.
    throw { ...mapApiError(0) };
  }
  if (!res.ok) {
    let apiMessage = '';
    try { apiMessage = (await res.json()).error?.message || ''; } catch {}
    throw { ...mapApiError(res.status, apiMessage) };
  }
  const data = await res.json();
  const list = data.data || [];
  const seen = new Set();
  const ids = [];
  for (const m of list) {
    const caps = m.capabilities || [];
    // Hanya embedding → buang; tanpa capabilities atau ada chat → ikut.
    const isEmbeddingOnly = caps.length > 0 && !caps.includes('chat/completions');
    if (m.owned_by === 'embedding' || isEmbeddingOnly) continue;
    const id = sanitizeModelId(m.id);
    if (!id || seen.has(id)) continue; // kosong atau duplikat → lewati
    seen.add(id);
    ids.push(id);
  }
  // Tampilkan SEMUA model chat-capable dari endpoint (sudah disaring: buang
  // embedding-only / owned_by='embedding', dedup per id). Dropdown kini bisa
  // memilih lebih dari satu model; chat tetap memakai SATU model terpilih.
  // Filter di atas sudah membuang model secondary/embedding, jadi tak perlu
  // dibatasi jumlahnya lagi. Ambil model aktif endpoint (mis. model yang dimuat
  // LM Studio) sebagai pilihan awal bila belum dipilih (lihat app.js).
  return ids;
}

// Hitung daftar id model yang PAS untuk dropdown setelah switch/tambah endpoint.
// Kembalikan [] bila endpoint tak punya model chat (listModels kosong) atau saat
// listModels GAGAL, sehingga UI mengosongkan dropdown — BUKAN mempertahankan model
// dari endpoint SEBELUMNYA yang menyebabkan daftar "stale" / menyesatkan. Dipakai
// refreshProviderModelList() di app.js: bila hasilnya [], dropdown direset.
export function pickModelIdsForDropdown(result) {
  if (!result || result.error || !Array.isArray(result.ids)) return [];
  const ids = result.ids.filter((id) => id && String(id).length > 0);
  return ids.length ? ids : [];
}

// ===== CHAT COMPLETION (PATH OPENAI) =====
// POST ${baseUrl}${chatPath} body { model, messages, max_tokens, tools?, generationConfig? }.
// Parameter: { provider, apiKey, model, systemPrompt, contents, maxTokens, thinkingLevel, grounding, onDelta, signal }
// `contents` = array { role: 'user'|'model', text } (riwayat penuh).
// onDelta(akumulasi) — bila fungsi diberikan, request streaming (SSE) dan
// tiap token dipanggil balik ke UI secara live; endpoint/browser yang tidak
// mendukung otomatis jatuh ke jalur non-stream biasa.
// Mengembalikan Promise<{ text, tokens:{prompt,completion,total}, sources }>.
export async function chatCompletion({
  provider, apiKey, model, systemPrompt, contents, contextMessages,
  maxTokens = 8192, thinkingLevel, grounding, onDelta, signal,
}) {
  if (!provider || !provider.baseUrl) {
    throw { type: 'badrequest', message: 'Pilih endpoint & model dulu, ya.' };
  }
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  const history = (contents || []).map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }));
  // Konteks (materi ter-fence) digabung ke pesan `user` PERTAMA agar tak ada dua
  // pesan `user` berurutan — sebagian model/endpoint menolak role berurutan (400).
  // Pemisahan anti-injeksi tetap terjaga: instruksi di `system`, data di `user`.
  const ctx = contextMessages || [];
  if (ctx.length && history.length && history[0].role === 'user') {
    const block = ctx.map((c) => c.content).join('\n\n');
    history[0] = { ...history[0], content: `${block}\n\n${history[0].content}` };
  } else {
    messages.push(...ctx);
  }
  messages.push(...history);

  const body = { model, messages, max_tokens: maxTokens };
  const wantStream = typeof onDelta === 'function';
  if (wantStream) {
    body.stream = true;
    body.stream_options = { include_usage: true }; // minta usage di chunk terakhir
  }
  if (provider.supportsThinking && thinkingLevel) {
    body.generationConfig = { thinkingLevel }; // hanya provider yang mendukung
  }

  let res;
  let streamStripped = false; // fallback 413: stream dilepas → respons jadi JSON
  let viaProxy = false;       // request pertama lewat proksi? (endpoint remote)
  try {
    res = await buildChatRequest(provider, apiKey, body, grounding, signal, {
      onViaProxy: () => { viaProxy = true; },
    });
  } catch (err) {
    // Pastikan error TIDAK keluar mentah (type undefined → "error API: undefined").
    // providerFetch melempar exception bila proksi /api/proxy juga gagal (mis.
    // endpoint memblokir server Vercel). Map ke network + pertahankan pesan asli.
    if (!err || typeof err.type === 'undefined') {
      const mapped = mapApiError(0);
      throw { ...mapped, message: (err && err.message) ? err.message : mapped.message };
    }
    throw err;
  }

  if (!res.ok) {
    // Tangkap body mentah (string) SEKALI: (a) pesan error JSON (.error.message),
    // (b) deteksi halaman "blocked"/Cloudflare agar pesan actionable. Body Response
    // hanya bisa dibaca sekali → simpan ke var, bukan dipanggil berkali-kali.
    let apiMessage = '';
    let rawText = '';
    try {
      rawText = await res.text();
      try { const j = JSON.parse(rawText); apiMessage = j.error?.message || ''; } catch {}
    } catch {}
    // ===== KASCADE KOMPATIBILITAS (400/413/422) =====
    // Sebagian model/endpoint menolak field tertentu (tools, stream_options,
    // max_tokens terlalu besar) atau body terlalu besar (413). Lucuti field
    // bertahap, satu per satu, sampai request diterima atau tak ada lagi yang
    // bisa dilepas — endpoint yang kompatibel tak pernah menyentuh jalur ini.
    let cur = body;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (res.ok || !(res.status === 400 || res.status === 413 || res.status === 422)) break;
      // Urutan lucut: penyebab 400 paling umum dulu.
      let fb = null;
      if (cur.tools) { fb = { ...cur }; delete fb.tools; }
      else if (cur.stream_options) { fb = { ...cur }; delete fb.stream_options; }
      else if (cur.max_tokens && cur.max_tokens > 2048) fb = { ...cur, max_tokens: 2048 };
      else if (cur.max_tokens) { fb = { ...cur }; delete fb.max_tokens; }
      else if (res.status === 413 && cur.stream) { fb = { ...cur }; delete fb.stream; streamStripped = true; }
      if (!fb) break;
      cur = fb;
      const target = joinProviderPath(provider.baseUrl, provider.chatPath);
      try {
        // Bila request pertama lewat proksi (endpoint remote/ngrok: fetch langsung
        // opaque/hang), retry juga lewat proksi LANGSUNG — hindari re-race
        // direct→proxy yang membuang waktu & kerja tiap stripped-field. Endpoint
        // lokal (direct cepat) tetap pakai providerFetch agar tak ada perubahan.
        res = viaProxy
          ? await proxyFetch(target, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
              body: JSON.stringify(cur),
              signal,
            })
          : await providerFetch(target, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
              body: JSON.stringify(cur),
              signal,
            });
      } catch { throw { ...mapApiError(0) }; }
      if (!res.ok) {
        try { apiMessage = (await res.json()).error?.message || apiMessage; } catch {}
      }
    }
    if (!res.ok) throw { ...mapApiError(res.status, apiMessage) };
  }

  // Jalur SSE: baca data: {...} per chunk, akumulasi delta.content,
  // panggil onDelta live, kumpulkan usage + SUMBER grounding dari chunk.
  // (Lewati bila fallback melepas stream — respons kini JSON biasa.)
  if (wantStream && !streamStripped && res.body && typeof res.body.getReader === 'function') {
    const streamed = await readSSE(res, onDelta, signal);
    return {
      text: streamed.text.trim(),
      tokens: {
        prompt: streamed.usage?.prompt_tokens ?? undefined,
        completion: streamed.usage?.completion_tokens ?? undefined,
        total: streamed.usage?.total_tokens ?? undefined,
      },
      sources: streamed.sources || [], // ambil dari chunk, bukan hardcode []
    };
  }

  // Jalur non-stream (fallback: tanpa onDelta, atau res.body tak didukung).
  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const text = pickMessageText(choice && choice.message);
  const usage = data.usage || {};
  const tokens = {
    prompt: usage.prompt_tokens ?? undefined,
    completion: usage.completion_tokens ?? undefined,
    total: usage.total_tokens ?? undefined,
  };
  let sources = [];
  // Sumber grounding: Gemini native baca candidates[], endpoint OpenAI-compatible
  // kirim citations/tool_calls di top-level body (atau choices[0].message).
  if (data.candidates) {
    sources = extractSources(data.candidates[0]);
  } else {
    sources = extractSources(data);
    if (!sources.length && choice?.message) sources = extractSources(choice.message);
  }
  return { text: text.trim(), tokens, sources };
}

// Sebagian model (mis. Gemma reasoning di LM Studio, DeepSeek-R1) mengirim
// jawaban di reasoning_content/reasoning, bukan content. Tanpa fallback ini
// balasan tampil kosong walau endpoint & format OpenAI-nya benar.
function pickMessageText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string' && msg.content.trim()) return msg.content;
  if (typeof msg.reasoning_content === 'string') return msg.reasoning_content;
  if (typeof msg.reasoning === 'string') return msg.reasoning;
  return typeof msg.content === 'string' ? msg.content : '';
}

// Parser SSE untuk chat streaming (format OpenAI):
// baris "data: {json}" diakhiri "data: [DONE]". Delta konten diambil dari
// choices[0].delta.content; usage (bila dikirim endpoint) dari chunk mana pun.
export async function readSSE(res, onDelta, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', reasoning = '', usage = null, sources = [];
  const handle = (payload) => {
    if (payload === '[DONE]') return;
    let ev; try { ev = JSON.parse(payload); } catch { return; } // baris rusak → lewati
    const choice = ev.choices && ev.choices[0];
    const delta = choice && choice.delta && choice.delta.content;
    const rdelta = choice && choice.delta && (choice.delta.reasoning_content || choice.delta.reasoning);
    if (typeof delta === 'string' && delta) { text += delta; onDelta(text); }
    else if (typeof rdelta === 'string' && rdelta) {
      reasoning += rdelta;
      if (!text) onDelta(reasoning); // hanya jika endpoint tak mengirim content
    }
    if (ev.usage) usage = ev.usage;
    // Tangkap sumber grounding bila muncul di chunk (terakhir menang).
    let src = extractSources(ev);
    if (!src.length && choice) src = extractSources(choice.message || choice);
    if (src && src.length) sources = src;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) handle(line.slice(5).trim());
      }
      // Berhenti setelah chunk ini diproses bila user sudah menekan Berhendi.
      if (signal && signal.aborted) break;
    }
    // Sisa buffer tanpa newline di akhir stream.
    const tail = buf.trim();
    if (tail.startsWith('data:')) handle(tail.slice(5).trim());
  } catch (err) {
    if (text || reasoning) return { text: text || reasoning, usage, sources }; // stream putus → pakai yang sudah datang
    throw { ...mapApiError(0), message: (err && err.message) || 'Koneksi streaming terputus.' };
  }
  return { text: text || reasoning, usage, sources };
}

// Bangun & kirim POST chat; tambahkan tools grounding bila diminta + didukung.
// `fetchOpts` diteruskan ke providerFetch (mis. { onViaProxy }) agar pemanggil
// bisa mencatat jalur transport request pertama.
async function buildChatRequest(provider, apiKey, body, grounding, signal, fetchOpts = {}) {
  if (grounding && provider.supportsGrounding) body.tools = [{ type: 'function', function: { name: 'google_search', description: 'web grounding' } }];
  return providerFetch(joinProviderPath(provider.baseUrl, provider.chatPath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
    body: JSON.stringify(body),
    signal,
  }, fetchOpts);
}

// Convenience untuk app.js: providerChat(id, params) → chatCompletion.
// Provider tidak dikenal → throw (TANPA fallback diam-diam).
export async function providerChat(providerName, params = {}) {
  const providers = resolveProviders(params.customProviders || []);
  const provider = providers[providerName];
  if (!provider) {
    throw { type: 'badrequest', message: 'Endpoint tidak dikenal. Pilih endpoint dulu di header chat.' };
  }
  return chatCompletion({ provider, ...params });
}
