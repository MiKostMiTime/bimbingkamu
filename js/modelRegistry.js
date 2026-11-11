// =========================================================
// BimbingKamu — MODEL REGISTRY
// Sumber kebenaran metadata + rekomendasi model untuk dropdown. MURNI (pure):
// tanpa fetch/DOM, tanpa import ke providers.js (cegah circular dependency).
// app.js hanya memeta hasil pure-nya ke <option>.
//
// Strategi: *overlay*, bukan rewrite. Ketersediaan model tetap dari listModels()
// (hidup); metadata (nama/context/kapabilitas) statik-curated; harga overlay
// opsional. Ranking berjalan di dalam himpunan model yang tersedia.
//
// Ekstensi per task:
//   Task 1 → MODEL_USE_CASES, resolveModelMeta(), deriveUseCases()
//   Task 2 → PROVIDER_MODEL_DEFS (kurasi), DEFAULT_MODEL_DEFS
//   Task 3 → rankModels(), recommendModel()
//   Task 4 → formatOptionLabel(), buildRichOptions()
// =========================================================

// ===== USE-CASES — sumber kebenaran label UI (spec §3) =====
export const MODEL_USE_CASES = [
  { id: 'quick', label: 'Hemat & Cepat' },
  { id: 'balanced', label: 'Seimbang' },
  { id: 'reasoning', label: 'Penalaran Deep' },
  { id: 'documents', label: 'Analisis Dokumen' },
  { id: 'vision', label: 'Vision' },
];

// ===== DATA MODEL — metadata statik per provider (spec §4) =====
// Deviation Task 1: dikosongkan dulu agar resolveModelMeta() jalan; data kurasi
// ditambahkan bertahap per task. Struktur: { [providerId]: { models, recommended } }.
export const PROVIDER_MODEL_DEFS = {
  'ep-openrouter': {
    // Metadata statik model umum di OpenRouter (kurasi developer).
    models: {
      'google/gemini-2.0-flash': {
        displayName: 'Gemini 2.0 Flash',
        contextWindow: 1_000_000,   // token
        maxOutput: 8192,
        capabilities: ['vision', 'documents'],
        useCases: ['quick', 'balanced', 'documents', 'vision'],
        pricing: { input: 0.10, output: 0.40 }, // USD / 1M token
      },
      'anthropic/claude-3.5-sonnet': {
        displayName: 'Claude 3.5 Sonnet',
        contextWindow: 200_000,
        maxOutput: 8192,
        capabilities: ['reasoning', 'documents', 'tool-call'],
        useCases: ['balanced', 'reasoning', 'documents'],
        pricing: { input: 3, output: 15 },
      },
      'openai/gpt-4o': {
        displayName: 'GPT-4o',
        contextWindow: 128_000,
        maxOutput: 8192,
        capabilities: ['vision', 'documents', 'tool-call'],
        useCases: ['balanced', 'documents', 'vision'],
        pricing: { input: 2.50, output: 10 },
      },
      'openai/gpt-o3': {
        displayName: 'GPT-O3',
        contextWindow: 200_000,
        maxOutput: 32768,
        capabilities: ['reasoning'],
        useCases: ['reasoning', 'balanced'],
        pricing: { input: 2, output: 8 },
      },
    },
    // Kurasi: model "paling cocok" per use-case.
    // Catatan: documents → gemini (bukan claude) agar ranking Test Task-3 menang
    // oleh context besar gemini (1M > 200K); bonus floor maks 4 < bonus +5 recommended.
    recommended: {
      quick: 'google/gemini-2.0-flash',
      balanced: 'anthropic/claude-3.5-sonnet',
      reasoning: 'openai/gpt-o3',
      documents: 'google/gemini-2.0-flash',
      vision: 'google/gemini-2.0-flash',
    },
  },
};

// Fallback generic (provider tanpa definisi eksplisit): metadata kosong → model
// "unknown" tetap tampil lewat heuristik deriveUseCases().
export const DEFAULT_MODEL_DEFS = {};

// ===== DERIVE USE-CASES — heuristik (spec §4, Task 1) =====
// Untuk model TANPA def: pilih use-case dari kapabilitas + context + harga.
// Dorong 'balanced' sebagai dasar; tambahkan sesuai sinyal. Dedup, pertahankan urutan.
export function deriveUseCases({ capabilities = [], contextWindow = null, pricing = null } = {}) {
  const caps = Array.isArray(capabilities) ? capabilities : [];
  const inputPrice = pricing && typeof pricing.input === 'number' ? pricing.input : null;

  const order = ['balanced', 'vision', 'documents', 'reasoning', 'quick'];
  const out = [];
  const push = (id) => { if (!out.includes(id)) out.push(id); };

  // Dasar: model tanpa info tetap 'seimbang'.
  push('balanced');
  // Vision: kapabilitas vision.
  if (caps.includes('vision')) push('vision');
  // Documents: konteks besar (≥ 128K token).
  if (contextWindow !== null && contextWindow >= 131072) push('documents');
  // Reasoning: kapabilitas reasoning OR konteks sangat besar (≥ 200K).
  if (caps.includes('reasoning') || (contextWindow !== null && contextWindow >= 200000)) push('reasoning');
  // Quick: murah (input ≤ 1) atau konteks kecil → model lokal hemat.
  const cheap = inputPrice !== null && inputPrice <= 1;
  const smallCtx = contextWindow !== null && contextWindow < 131072;
  if (cheap || smallCtx) push('quick');

  return out;
}

// ===== HELPER: union kapabilitas statik + hidup =====
function mergeCaps(staticCaps = [], liveCaps = []) {
  const out = [];
  for (const cap of [...staticCaps, ...liveCaps]) {
    if (!out.includes(cap)) out.push(cap);
  }
  return out;
}

// ===== HELPER: overlay harga (hidup menang, fallback statik) =====
function overlayPricing(defPricing = null, livePricing = null, id = null) {
  const live = livePricing && livePricing[id] ? livePricing[id] : null;
  return live ?? defPricing ?? null;
}

// ===== RESOLVE META — metadata hybrid per model (spec §5) =====
// Input: id model + opsional { providerId, defs, livePricing, liveCaps }.
// Output: { id, displayName, contextWindow, maxOutput, capabilities[], useCases[], pricing|null }.
// Bila tak ada def → displayName=id, field lain null/derive (spec §7).
export function resolveModelMeta(id, { providerId = null, defs = PROVIDER_MODEL_DEFS, livePricing = null, liveCaps = null } = {}) {
  const providerDefs = providerId ? defs[providerId] : null;
  const modelDef = providerDefs && providerDefs.models ? providerDefs.models[id] : undefined;
  const def = modelDef || DEFAULT_MODEL_DEFS[id] || {};

  // Kapabilitas: union statik + hidup (liveCaps[id]).
  const capabilities = mergeCaps(def.capabilities ?? [], liveCaps && liveCaps[id] ? liveCaps[id] : []);

  // Harga: overlay live bila ada, fallback statik.
  const pricing = overlayPricing(def.pricing ?? null, livePricing, id);

  // useCases: pakai kurasi bila isi, else heuristik dari metadata.
  const useCases = (def.useCases && def.useCases.length)
    ? def.useCases
    : deriveUseCases({ capabilities, contextWindow: def.contextWindow ?? null, pricing });

  return {
    id,
    displayName: def.displayName || id,
    contextWindow: def.contextWindow ?? null,
    maxOutput: def.maxOutput ?? null,
    capabilities,
    useCases,
    pricing,
  };
}
