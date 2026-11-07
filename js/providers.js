// =========================================================
// BimbingKamu — REGISTRY PROVIDER + listModels
// Registry provider [OI]-compatible: TANPA provider bawaan.
// Semua endpoint ditambahkan user (mis. http://127.0.0.1:1234);
// daftar model SELALU diambil dari endpoint itu sendiri, sehingga
// tidak ada model hardcode yang bisa menimbulkan error.
// Murni modul (tanpa DOM); error dari fetch dipeta ke mapApiError.
// =========================================================
import { mapApiError, extractSources } from './api.js';

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
    if (p.baseUrl) all[p.id] = { ...p, custom: true };
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

// ===== PROBE ENDPOINT (baru) =====
// Verifikasi Base URL saat ditambahkan: coba GET {base}/models lalu
// {base}/v1/models — simpan path yang hidup supaya chat nanti tidak
// menebak-nebak. Return { modelsPath, chatPath }; gagal keduanya → throw
// error ramah. Header auth hanya dikirim bila kunci diisi.
export async function probeEndpoint(baseUrl, apiKey = '') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw { type: 'badrequest', message: 'Masukkan URL endpoint dulu, ya.' };
  }
  const candidates = ['/models', '/v1/models'];
  let lastErr = null;
  for (const modelsPath of candidates) {
    let res;
    try {
      res = await fetch(`${base}${modelsPath}`, { headers: authHeader(apiKey) });
    } catch {
      // Browser melempar TypeError tanpa detail saat: offline, URL salah,
      // ATAU respons diblokir CORS (server tidak mengirim
      // Access-Control-Allow-Origin). Sebut keduanya di pesan.
      lastErr = {
        type: 'network',
        message:
          'Tidak bisa terhubung ke endpoint. Periksa URL & koneksi — bila endpoint lokal (LM Studio/Ollama), aktifkan "Enable CORS" / CORS di pengaturan server-nya.',
      };
      continue; // coba kandidat berikutnya
    }
    if (res.ok) {
      // Validasi body — status 200 tidak cukup. LM Studio menjawab
      // GET /models dengan 200 + {"error": ...} → path itu harus ditolak.
      let looksLikeModels = false;
      try {
        const data = await res.json();
        looksLikeModels = data && !data.error && Array.isArray(data.data);
      } catch { looksLikeModels = false; }
      if (looksLikeModels) {
        // chatPath disimpulkan dari modelsPath yang hidup.
        const chatPath = modelsPath.replace(/\/models$/, '/chat/completions');
        return { modelsPath, chatPath };
      }
      lastErr = {
        type: 'badrequest',
        message: `${modelsPath} merespons tapi bukan daftar model. Coba URL lain (mis. .../v1).`,
      };
      continue; // coba kandidat berikutnya
    }
    lastErr = { ...mapApiError(res.status, '') };
  }
  throw lastErr || {
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
    const res = await fetch(`${provider.baseUrl}/api/v0/models`, { headers: authHeader(apiKey) });
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
      const res = await fetch('https://openrouter.ai/api/v1/models', { headers: authHeader(apiKey) });
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
    const res = await fetch(`${provider.baseUrl}/api/v0/models`, { headers: authHeader(apiKey) });
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

export async function listModels(apiKey, provider) {
  if (!provider || !provider.baseUrl) {
    throw { type: 'badrequest', message: 'Endpoint belum terdaftar. Tambahkan endpoint dulu.' };
  }
  let res;
  try {
    res = await fetch(`${provider.baseUrl}${provider.modelsPath}`, { headers: authHeader(apiKey) });
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
  // Batasi ke SATU model per endpoint (model pertama yang valid) agar chat hanya
  // memakai satu model — mencegah crash bila endpoint melaporkan beberapa model
  // (mis. embedding/secondary) yang tak bisa dipakai di perangkat user. Ambil model
  // aktif endpoint (mis. model yang dimuat LM Studio).
  return ids.slice(0, 1);
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
  try {
    res = await buildChatRequest(provider, apiKey, body, grounding, signal);
  } catch (err) {
    throw err;
  }

  if (!res.ok) {
    let apiMessage = '';
    try { apiMessage = (await res.json()).error?.message || ''; } catch {}
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
      try {
        res = await fetch(`${provider.baseUrl}${provider.chatPath}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
          body: JSON.stringify(cur), signal,
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
  const text = (choice && choice.message && choice.message.content) || '';
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

// Parser SSE untuk chat streaming (format OpenAI):
// baris "data: {json}" diakhiri "data: [DONE]". Delta konten diambil dari
// choices[0].delta.content; usage (bila dikirim endpoint) dari chunk mana pun.
export async function readSSE(res, onDelta, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', usage = null, sources = [];
  const handle = (payload) => {
    if (payload === '[DONE]') return;
    let ev; try { ev = JSON.parse(payload); } catch { return; } // baris rusak → lewati
    const choice = ev.choices && ev.choices[0];
    const delta = choice && choice.delta && choice.delta.content;
    if (delta) { text += delta; onDelta(text); }
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
    if (text) return { text, usage, sources }; // stream putus di tengah → pakai yang sudah datang
    throw { ...mapApiError(0), message: (err && err.message) || 'Koneksi streaming terputus.' };
  }
  return { text, usage, sources };
}

// Bangun & kirim POST chat; tambahkan tools grounding bila diminta + didukung.
async function buildChatRequest(provider, apiKey, body, grounding, signal) {
  if (grounding && provider.supportsGrounding) body.tools = [{ type: 'function', function: { name: 'google_search', description: 'web grounding' } }];
  return fetch(`${provider.baseUrl}${provider.chatPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
    body: JSON.stringify(body),
    signal,
  });
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
