// tests/settings.test.mjs — presedensi kunci per-endpoint + CRUD endpoint.
// Murni: import dari ../js/providers.js (tanpa DOM / inisialisasi app.js).
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  resolveApiKey,
  addProvider,
  updateProvider,
  removeProvider,
  nextActiveAfterDelete,
  resolveProviders,
} = await import('../js/providers.js');

// ===== resolveApiKey: presedensi kunci per-endpoint =====
test('resolveApiKey: kunci endpoint menang', () => {
  assert.equal(resolveApiKey({ ep1: { key: 'K_EP' } }, 'ep1', 'LEG'), 'K_EP');
});
test('resolveApiKey: fallback kunci umum bila endpoint kosong', () => {
  assert.equal(resolveApiKey({ ep1: { key: '' } }, 'ep1', 'LEG'), 'LEG');
});
test('resolveApiKey: fallback umum dipakai bila endpoint tak terdaftar', () => {
  assert.equal(resolveApiKey({}, 'x', 'LEG'), 'LEG');
});
test('resolveApiKey: kosong bila tak ada apa-apa', () => {
  assert.equal(resolveApiKey({}, '', ''), '');
});

// ===== addProvider / updateProvider / nextActiveAfterDelete (CRUD) =====
test('addProvider: append endpoint baru', () => {
  const r = addProvider([{ id: 'a' }], { id: 'b' });
  assert.equal(r.length, 2);
  assert.deepEqual(r[1].id, 'b');
});
test('updateProvider: perbarui entry berdasar id (idempotent)', () => {
  const r = updateProvider([{ id: 'a', key: '' }], 'a', { key: 'K' });
  assert.equal(r.length, 1);
  assert.equal(r[0].key, 'K');
});
test('updateProvider: tak mengganggu entry lain', () => {
  const r = updateProvider([{ id: 'a' }, { id: 'b' }], 'a', { key: 'K' });
  assert.equal(r[1].id, 'b');
  assert.equal(r[1].key, undefined);
});
test('nextActiveAfterDelete: pindah ke endpoint lain bila aktif dihapus', () => {
  const ps = [{ id: 'a' }, { id: 'b' }];
  assert.equal(nextActiveAfterDelete(ps, 'a', 'a'), 'b');
});
test('nextActiveAfterDelete: tetap aktif bila endpoint lain dihapus', () => {
  const ps = [{ id: 'a' }, { id: 'b' }];
  assert.equal(nextActiveAfterDelete(ps, 'b', 'a'), 'b');
});
test("nextActiveAfterDelete: '' (kosong) bila endpoint terakhir dihapus", () => {
  assert.equal(nextActiveAfterDelete([{ id: 'a' }], 'a', 'a'), '');
});

// ===== removeProvider: custom dibuang, seed disembunyikan =====
test('removeProvider: endpoint custom dibuang dari array', () => {
  const r = removeProvider([{ id: 'ep-x', baseUrl: 'http://x' }], 'ep-x');
  assert.deepEqual(r, []);
});

test('removeProvider: seed tanpa override → tambah override hidden', () => {
  const r = removeProvider([], 'ep-openrouter');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'ep-openrouter');
  assert.equal(r[0].hidden, true);
  assert.ok(r[0].baseUrl);
});

test('removeProvider: seed dengan override → tandai hidden tanpa duplikat', () => {
  const r = removeProvider(
    [{ id: 'ep-gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'K' }],
    'ep-gemini'
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].hidden, true);
  assert.equal(r[0].key, 'K');
});

// ===== resolveProviders: override & hidden (endpoint bawaan) =====
test('resolveProviders: seed tampil saat belum ada override', () => {
  const all = resolveProviders([]);
  assert.equal(all['ep-openrouter'].name, 'OpenRouter');
});

test('resolveProviders: override seed menimpa kunci + jadi custom', () => {
  const all = resolveProviders([
    { id: 'ep-openrouter', baseUrl: 'https://openrouter.ai/api/v1', key: 'K_EP' },
  ]);
  assert.equal(all['ep-openrouter'].key, 'K_EP');
  assert.equal(all['ep-openrouter'].custom, true);
});

test('resolveProviders: override hidden menyembunyikan endpoint bawaan', () => {
  const all = resolveProviders([
    { id: 'ep-openrouter', baseUrl: 'https://openrouter.ai/api/v1', hidden: true },
  ]);
  assert.equal(all['ep-openrouter'], undefined);
});

test('resolveProviders: endpoint custom hidden juga tidak tampil', () => {
  const all = resolveProviders([{ id: 'ep-x', baseUrl: 'http://x', hidden: true }]);
  assert.equal(all['ep-x'], undefined);
});

test('resolveProviders: entry tanpa id/baseUrl diabaikan', () => {
  const all = resolveProviders([{ id: 'ep-x' }, null]);
  assert.equal(all['ep-x'], undefined);
});
