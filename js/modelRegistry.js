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

// ===== SCORING — skor per (model, use-case) (spec §6) =====
// Skor berjalan di atas meta yang SUDAH ter-resolve (input rankModels).
//   +5  id === recommended[useCase]        (kurasi developer)
//   +3  meta.useCases INCLUDE useCase       (metadata statik)
//   'vision'    : +4 bila capabilities includes 'vision'
//   'documents' : +3 bila capabilities includes 'document'|'large-context'
//                 + floor(contextWindow/250_000) maks 4
//   'reasoning' : +3 bila capabilities includes 'reasoning'
//   'quick'     : +min(3, max(0, round(2.5 - inputPrice)))  (makin murah → lebih tinggi)
function scoreModel(meta, useCase, recommendedMap = {}) {
  let score = 0;
  const caps = meta.capabilities || [];
  const inputPrice = meta.pricing && typeof meta.pricing.input === 'number' ? meta.pricing.input : Infinity;

  // +5 kurasi: model terpilih sebagai rekomendasi use-case.
  if (meta.id === recommendedMap[useCase]) score += 5;
  // +3 metadata statik: model menargetkan use-case ini.
  if (meta.useCases && meta.useCases.includes(useCase)) score += 3;

  switch (useCase) {
    case 'vision':
      if (caps.includes('vision')) score += 4;
      break;
    case 'documents':
      if (caps.includes('document') || caps.includes('large-context')) score += 3;
      if (typeof meta.contextWindow === 'number') {
        score += Math.min(Math.floor(meta.contextWindow / 250_000), 4);
      }
      break;
    case 'reasoning':
      if (caps.includes('reasoning')) score += 3;
      break;
    case 'quick':
      score += Math.min(3, Math.max(0, Math.round(2.5 - inputPrice)));
      break;
    default:
      break;
  }

  return score;
}

// ===== RANK MODELS — rekomendasi per use-case (spec §6) =====
// Input: models = [{ id, meta }] (hanya model TERSEDIA dari listModels).
// Output: [{ id, meta, recommendedFor: useCaseId[] }] — daftar case yang dimenninya.
// Per use-case: skor semua model → maxScore = max(0, ...skor); bila >0, tandai
// semua winner (skor === maxScore). Model tanpa def tetap ikut (heuristik).
export function rankModels(models, { providerId = null, defs = PROVIDER_MODEL_DEFS, cases = MODEL_USE_CASES } = {}) {
  if (!Array.isArray(models) || !models.length) return [];

  const recommendedMap = providerId && defs[providerId] ? defs[providerId].recommended : {};
  // Jejak skor per model per use-case (urutan case = MODEL_USE_CASES).
  const scores = new Map();
  models.forEach((m) => scores.set(m.id, {}));

  for (const c of cases) {
    const caseId = c.id;
    const perModel = {};
    for (const m of models) {
      const s = scoreModel(m.meta, caseId, recommendedMap);
      perModel[m.id] = s;
    }
    const maxScore = Math.max(0, ...Object.values(perModel));
    if (maxScore > 0) {
      // Tandai semua winner (tie → semua yang seri).
      for (const m of models) {
        if (perModel[m.id] === maxScore) scores.get(m.id)[caseId] = true;
      }
    }
  }

  return models.map((m) => ({
    id: m.id,
    meta: m.meta,
    recommendedFor: cases.filter((c) => scores.get(m.id)[c.id]).map((c) => c.id),
  }));
}

// ===== RECOMMEND MODEL — top model untuk SATU use-case (spec §6) =====
// Output: { id, meta, score } | null (null bila tak ada yang menang / kosong).
export function recommendModel(models, useCaseId, { providerId = null, defs = PROVIDER_MODEL_DEFS } = {}) {
  if (!Array.isArray(models) || !models.length) return null;
  const recommendedMap = providerId && defs[providerId] ? defs[providerId].recommended : {};

  let best = null;
  let bestScore = 0; // perlu > 0 agar bermakna
  for (const m of models) {
    const s = scoreModel(m.meta, useCaseId, recommendedMap);
    if (s > bestScore) {
      best = { id: m.id, meta: m.meta, score: s };
      bestScore = s;
    }
  }
  return best; // null bila tak ada skor > 0
}
