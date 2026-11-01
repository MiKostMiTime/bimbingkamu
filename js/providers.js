// =========================================================
// TanyaBukan — REGISTRY PROVIDER + listModels
// Registry provider OpenAI-compatible: daftar model otomatis
// menyesuaikan endpoint. Murni modul (tanpa DOM); error dari
// fetch dipeta ke mapApiError agar ramah pemakai.
// =========================================================
import { mapApiError } from './api.js';

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
