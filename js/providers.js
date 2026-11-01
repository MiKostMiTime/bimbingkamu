// =========================================================
// TanyaBukan — REGISTRY PROVIDER + listModels
// Registry provider OpenAI-compatible: daftar model otomatis
// menyesuaikan endpoint. Murni modul (tanpa DOM); error dari
// fetch dipeta ke mapApiError agar ramah pemakai.
// =========================================================
import { mapApiError, extractSources } from './api.js';

// Provider default: Gemini lewat adapter OpenAI (/openai/models,
// /openai/chat/completions) dengan header x-goog-api-key.
export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Gemini (default)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsPath: '/openai/models',
    chatPath: '/openai/chat/completions',
    authHeader: 'x-goog-api-key',
    supportsGrounding: true,
    supportsThinking: true,
  },
};

// Registry = default + custom (array dari settings.providers).
// Custom hanya dimasukkan bila punya id + baseUrl; diberi flag custom.
export function resolveProviders(custom = []) {
  const all = { ...PROVIDERS };
  for (const p of custom) {
    if (p && p.id && p.baseUrl) all[p.id] = { ...p, custom: true };
  }
  return all;
}

// Header otentikasi: header khusus provider (mis. x-goog-api-key)
// atau Bearer default untuk endpoint custom.
function authHeader(provider, apiKey) {
  if (provider.authHeader === 'x-goog-api-key') return { [provider.authHeader]: apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}

// Ambil daftar ID model chat-capable dari endpoint provider.
// GET ${baseUrl}${modelsPath} → filter model yang bisa chat, dedup per id.
export async function listModels(apiKey, provider = PROVIDERS.gemini) {
  let res;
  try {
    res = await fetch(`${provider.baseUrl}${provider.modelsPath}`, { headers: authHeader(provider, apiKey) });
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
// Panggil endpoint OpenAI-shaped provider (default: Gemini adapter).
// POST ${baseUrl}${chatPath} body { model, messages, max_tokens, tools?, generationConfig? }.
// Parameter: { provider, apiKey, model, systemPrompt, contents, maxTokens, thinkingLevel, grounding }
// `contents` = array { role: 'user'|'model', text } (riwayat penuh).
// Mengembalikan Promise<{ text, tokens:{prompt,completion,total}, sources }>.
export async function chatCompletion({
  provider = PROVIDERS.gemini, apiKey, model, systemPrompt, contents,
  maxTokens = 8192, thinkingLevel, grounding,
}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (const m of contents || []) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text });

  const body = { model, messages, max_tokens: maxTokens };
  if (provider.supportsThinking && thinkingLevel) {
    body.generationConfig = { thinkingLevel }; // Gemini adapter; provider lain abaikan
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
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader(provider, apiKey) },
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
  if (data.candidates) sources = extractSources(data.candidates[0]); // Gemini: sumber dari groundingMetadata
  return { text: text.trim(), tokens, sources };
}

// Bangun & kirim POST chat; tambahkan tools grounding bila diminta + didukung.
async function buildChatRequest(provider, apiKey, body, grounding) {
  if (grounding && provider.supportsGrounding) body.tools = [{ type: 'function', function: { name: 'google_search', description: 'web grounding' } }];
  return fetch(`${provider.baseUrl}${provider.chatPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(provider, apiKey) },
    body: JSON.stringify(body),
  });
}

// Convenience untuk app.js: providerChat('gemini', params) → chatCompletion.
export async function providerChat(providerName, params = {}) {
  const providers = resolveProviders(params.customProviders || []);
  return chatCompletion({ provider: providers[providerName] || PROVIDERS.gemini, ...params });
}
