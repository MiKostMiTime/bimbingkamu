// =========================================================
// BimbingKamu — MODEL REGISTRY (uji unit fungsi murni)
// Modul: js/modelRegistry.js (metadata hybrid + rekomendasi per use-case).
// Murni: tanpa fetch/DOM, tanpa import ke providers.js. Dijalankan:
//   node --test tests/modelRegistry.test.js
// =========================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelMeta, deriveUseCases, MODEL_USE_CASES, PROVIDER_MODEL_DEFS } from '../js/modelRegistry.js';

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
