// =========================================================
// TanyaBukan — REGISTRY PROVIDER + listModels
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

// Registry = custom dari settings.providers. Custom hanya dimasukkan
// bila punya id + baseUrl; diberi flag custom.
export function resolveProviders(custom = []) {
  const all = { ...PROVIDERS };
  for (const p of custom) {
    if (p && p.id && p.baseUrl) all[p.id] = { ...p, custom: true };
  }
  return all;
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
// Prioritas sumber harga { input, output } per 1M token (USD):
//   1. provider.pricing — input manual user di Pengaturan (sumber termurah &
//      paling benar untuk endpoint berbayar yang tak melaporkan harga).
//   2. LM Studio /api/v0/models → model lokal → Rp0 (gratis, tidak berbayar).
//   3. OpenRouter (baseUrl mengandung openrouter.ai) → GET /api/v1/models
//      live pricing dari endpoint itu sendiri.
// Selain itu → null (UI menampilkan token tanpa biaya).
export async function fetchModelPricing(provider, apiKey, model) {
  if (!provider || !provider.baseUrl || !model) return null;
  // 1) Input manual user menang.
  const p = provider.pricing;
  if (p && Number(p.input) >= 0 && Number(p.output) >= 0 && (Number(p.input) || Number(p.output))) {
    return { input: Number(p.input), output: Number(p.output), source: 'manual' };
  }
  // 2) LM Studio → endpoint lokal, model gratis.
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
    if (seen.has(m.id)) continue; // duplikat id → lewati
    seen.add(m.id);
    ids.push(m.id);
  }
  return ids;
}

// ===== CHAT COMPLETION (PATH OPENAI) =====
// POST ${baseUrl}${chatPath} body { model, messages, max_tokens, tools?, generationConfig? }.
// Parameter: { provider, apiKey, model, systemPrompt, contents, maxTokens, thinkingLevel, grounding }
// `contents` = array { role: 'user'|'model', text } (riwayat penuh).
// Mengembalikan Promise<{ text, tokens:{prompt,completion,total}, sources }>.
export async function chatCompletion({
  provider, apiKey, model, systemPrompt, contents,
  maxTokens = 8192, thinkingLevel, grounding,
}) {
  if (!provider || !provider.baseUrl) {
    throw { type: 'badrequest', message: 'Pilih endpoint & model dulu, ya.' };
  }
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (const m of contents || []) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text });

  const body = { model, messages, max_tokens: maxTokens };
  if (provider.supportsThinking && thinkingLevel) {
    body.generationConfig = { thinkingLevel }; // hanya provider yang mendukung
  }

  let res;
  try {
    res = await buildChatRequest(provider, apiKey, body, grounding);
  } catch (err) {
    throw err;
  }

  if (!res.ok) {
    let apiMessage = '';
    try { apiMessage = (await res.json()).error?.message || ''; } catch {}
    // Graceful degradation: tools → coba ulang tanpa tools bila request-ditolak (400/422).
    const bodyStr = JSON.stringify(body);   // body sudah punya tools (dari buildChatRequest)
    const withoutTools = { ...JSON.parse(bodyStr) };
    delete withoutTools.tools;
    if ((res.status === 400 || res.status === 422) && body.tools && !withoutTools.tools) {
      try {
        res = await fetch(`${provider.baseUrl}${provider.chatPath}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
          body: JSON.stringify(withoutTools),
        });
      } catch { throw { ...mapApiError(0) }; }
    }
    if (!res.ok) throw { ...mapApiError(res.status, apiMessage) };
  }

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
  if (data.candidates) sources = extractSources(data.candidates[0]); // sumber grounding bila ada
  return { text: text.trim(), tokens, sources };
}

// Bangun & kirim POST chat; tambahkan tools grounding bila diminta + didukung.
async function buildChatRequest(provider, apiKey, body, grounding) {
  if (grounding && provider.supportsGrounding) body.tools = [{ type: 'function', function: { name: 'google_search', description: 'web grounding' } }];
  return fetch(`${provider.baseUrl}${provider.chatPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
    body: JSON.stringify(body),
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
