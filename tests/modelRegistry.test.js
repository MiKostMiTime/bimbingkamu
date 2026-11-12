// =========================================================
// BimbingKamu — MODEL REGISTRY (uji unit fungsi murni)
// Modul: js/modelRegistry.js (metadata hybrid + rekomendasi per use-case).
// Murni: tanpa fetch/DOM, tanpa import ke providers.js. Dijalankan:
//   node --test tests/modelRegistry.test.js
// =========================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelMeta, deriveUseCases, MODEL_USE_CASES, PROVIDER_MODEL_DEFS, rankModels, recommendModel, formatOptionLabel, buildRichOptions } from '../js/modelRegistry.js';

// ===== TASK 1 — Core metadata =====

test('MODEL_USE_CASES: punya 5 case id benar', () => {
  const ids = MODEL_USE_CASES.map((c) => c.id);
  assert.equal(ids.length, 5);
  for (const id of ['quick', 'balanced', 'reasoning', 'documents', 'vision']) {
    assert.ok(ids.includes(id), `harus ada case '${id}'`);
  }
});

test('resolveModelMeta: tanpa def → displayName=id, field null, useCases terisi', () => {
  const meta = resolveModelMeta('x', {});
  assert.equal(meta.id, 'x');
  assert.equal(meta.displayName, 'x');
  assert.equal(meta.contextWindow, null);
  assert.equal(meta.pricing, null);
  assert.ok(Array.isArray(meta.useCases), 'useCases array');
  assert.ok(meta.useCases.length > 0, 'useCases tak kosong');
  assert.ok(meta.useCases.includes('balanced'), 'minimal balanced');
});

test('deriveUseCases: vision + context besar → dokumen & cepat', () => {
  const cases = deriveUseCases({ capabilities: ['vision'], contextWindow: 1_000_000, pricing: { input: 0.1 } });
  assert.ok(cases.includes('vision'), 'cap vision → vision');
  assert.ok(cases.includes('documents'), 'context ≥ 131072 → documents');
  assert.ok(cases.includes('quick'), 'input ≤ 1 → quick');
});

// ===== TASK 2 — Curated data: PROVIDER_MODEL_DEFS (ep-openrouter) =====

test('PROVIDER_MODEL_DEFS: ep-openrouter gemini metadata kurasi', () => {
  const g = PROVIDER_MODEL_DEFS['ep-openrouter'].models['google/gemini-2.0-flash'];
  assert.equal(g.displayName, 'Gemini 2.0 Flash');
  assert.equal(g.contextWindow, 1000000);
  assert.equal(g.pricing.input, 0.10);
});

test('resolveModelMeta: gemini via ep-openrouter → useCases + capabilities', () => {
  const meta = resolveModelMeta('google/gemini-2.0-flash', { providerId: 'ep-openrouter' });
  assert.ok(meta.useCases.includes('quick'), 'useCases ada quick');
  assert.ok(meta.useCases.includes('vision'), 'useCases ada vision');
  assert.ok(meta.capabilities.includes('vision'), 'capabilities ada vision');
});

// ===== TASK 3 — Ranking: rankModels() + recommendModel() =====

// Siapkan data uji: resolve meta per model lewat def inline (recommended hanya quick+vision).
const mk = (id, over = {}) => ({
  id,
  meta: resolveModelMeta(id, {
    providerId: 'ep-openrouter',
    defs: {
      'ep-openrouter': {
        models: { [id]: { capabilities: ['vision'], useCases: ['quick', 'balanced', 'vision'], pricing: { input: 0.1 }, contextWindow: 1_000_000, ...over } },
        recommended: { quick: 'google/gemini-2.0-flash', vision: 'google/gemini-2.0-flash' },
      },
    },
  }),
});
const models = [
  mk('google/gemini-2.0-flash'),
  mk('anthropic/claude-3.5-sonnet', { capabilities: ['reasoning', 'documents'], useCases: ['balanced', 'reasoning', 'documents'], pricing: { input: 3 }, contextWindow: 200_000 }),
];

test('rankModels: recommended kurasi menang di use-case terkait', () => {
  const r = rankModels(models, { providerId: 'ep-openrouter' });
  const gemini = r.find((m) => m.id === 'google/gemini-2.0-flash');
  assert.ok(gemini.recommendedFor.includes('quick'), 'gemini rekomendasi quick (kurasi)');
});

test('rankModels: bonus kapabilitas vision', () => {
  const r = rankModels(models, { providerId: 'ep-openrouter' });
  const gemini = r.find((m) => m.id === 'google/gemini-2.0-flash');
  assert.ok(gemini.recommendedFor.includes('vision'), 'model vision → rekomendasi vision');
});

test('rankModels: context besar nilai lebih di documents', () => {
  // gemini context 1M > claude 200K → dokumen menang Gemini
  const r = rankModels(models, { providerId: 'ep-openrouter' });
  const gemini = r.find((m) => m.id === 'google/gemini-2.0-flash');
  assert.ok(gemini.recommendedFor.includes('documents'));
});

test('rankModels: input [] → []; model tanpa def tetap ikut', () => {
  assert.deepEqual(rankModels([], { providerId: 'ep-openrouter' }), []);
  const r = rankModels([{ id: 'model-lokal', meta: resolveModelMeta('model-lokal', { providerId: 'ep-electronhub' }) }], { providerId: 'ep-electronhub' });
  assert.equal(r.length, 1); // tak throw, tetap diranking
});

test('recommendModel: kembalikan top per case; null bila kosong', () => {
  const rec = recommendModel(models, 'quick', { providerId: 'ep-openrouter' });
  assert.equal(rec.id, 'google/gemini-2.0-flash');
  assert.deepEqual(recommendModel([], 'quick', { providerId: 'ep-openrouter' }), null);
});

// ===== TASK 4 — Label: formatOptionLabel() + buildRichOptions() =====

// Helper: meta gemini & claude ter-resolve dari kurasi ep-openrouter.
const metaGemini = resolveModelMeta('google/gemini-2.0-flash', { providerId: 'ep-openrouter' });
const metaClaude = resolveModelMeta('anthropic/claude-3.5-sonnet', { providerId: 'ep-openrouter' });

test('formatOptionLabel: context + harga tanpa bintang (gemini)', () => {
  // gemini menang >1 case → tak ada caseLabel; format: 1000K · $0.10/M
  const label = formatOptionLabel(metaGemini, { recommendedFor: ['quick', 'documents', 'vision'] });
  assert.match(label, /^Gemini 2\.0 Flash \u00b7 1000K \u00b7 \$0\.10\/M$/); // nama · 1000K · $0.10/M
  assert.ok(!label.includes('\u2b50'), 'bintang dihapus (tak konsisten)');
  assert.ok(!label.includes('Hemat'), 'tak ada caseLabel bila >1 case');
});

test('formatOptionLabel: harga bilangan utuh tanpa desimal (claude input=3 → $3/M)', () => {
  const label = formatOptionLabel(metaClaude, { isRecommended: true, recommendedFor: ['balanced', 'reasoning'] });
  assert.match(label, / \u00b7 200K \u00b7 \$3\/M$/);         // $3/M, bukan $3.00/M
});

test('formatOptionLabel: tanpa rekomendasi → tak ada bintang', () => {
  const label = formatOptionLabel(metaGemini, { isRecommended: false, recommendedFor: [] });
  assert.ok(!label.includes('\u2b50'), 'tak bintang');
  assert.match(label, /^Gemini 2\.0 Flash/);                 // tetap displayName + metadata
});

test('formatOptionLabel: caseLabel muncul bila unggul tepat SATU case', () => {
  const label = formatOptionLabel(metaGemini, { recommendedFor: ['quick'] });
  assert.equal(label, 'Gemini 2.0 Flash \u00b7 Hemat & Cepat \u00b7 1000K \u00b7 $0.10/M');
});

test('formatOptionLabel: model gratis ditandai "Gratis", bukan $0/M', () => {
  const freeByPricing = formatOptionLabel(
    { id: 'some/model', displayName: 'Model Gratis', contextWindow: 32000, pricing: { input: 0, output: 0 } },
    {},
  );
  assert.equal(freeByPricing, 'Model Gratis \u00b7 32K \u00b7 Gratis');
  const freeBySuffix = formatOptionLabel({ id: 'meta-llama/llama-4:free', displayName: 'Llama 4', pricing: null }, {});
  assert.equal(freeBySuffix, 'Llama 4 \u00b7 Gratis');
  // Berbayar tetap harga.
  const paid = formatOptionLabel({ id: 'x', displayName: 'X', pricing: { input: 0.5, output: 1 } }, {});
  assert.equal(paid, 'X \u00b7 $0.50/M');
});

test('formatOptionLabel: model unknown → label id saja (graceful)', () => {
  const metaUnknown = resolveModelMeta('llama-3.3-70b', { providerId: 'ep-electronhub' });
  const label = formatOptionLabel(metaUnknown, {});
  assert.equal(label, 'llama-3.3-70b');                      // id polos, tak bintang/metadata
});

test('buildRichOptions: kembalikan option value-ready {id,label,recommendedFor}', () => {
  const ranked = rankModels(models, { providerId: 'ep-openrouter' });
  const ids = models.map((m) => m.id);
  const opts = buildRichOptions('ep-openrouter', ids, { ranked });
  assert.equal(opts.length, ids.length);
  // value option = id model (backward compat), label kaya, recommendedFor terisi.
  for (const o of opts) {
    assert.equal(typeof o.id, 'string');
    assert.equal(o.id, ids.find((x) => x === o.id));         // id valid
    assert.equal(typeof o.label, 'string');
    assert.ok(Array.isArray(o.recommendedFor));
  }
  const gemini = opts.find((o) => o.id === 'google/gemini-2.0-flash');
  assert.ok(!gemini.label.includes('\u2b50'), 'label tanpa bintang');
  assert.ok(gemini.recommendedFor.length > 0, 'gemini direkomendasikan');
});

test('buildRichOptions: value = id (config settings.model lama tetap valid)', () => {
  const ranked = rankModels(models, { providerId: 'ep-openrouter' });
  const opts = buildRichOptions('ep-openrouter', ['google/gemini-2.0-flash'], { ranked });
  assert.equal(opts[0].id, 'google/gemini-2.0-flash');       // value option = id penuh
});
