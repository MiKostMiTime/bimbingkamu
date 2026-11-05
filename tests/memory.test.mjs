// Uji modul memori: persist persona + catatan lintas sesi (localStorage).
// Jalankan: node --test tests/memory.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// Fake localStorage in-memory.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

// Import fresh (query unik → modul dievaluasi ulang → capture localStorage baru).
async function loadMem(storage) {
  globalThis.localStorage = storage;
  return import(`../js/memory.js?u=${Math.random()}`);
}

test('memory: seed default persona + buildMemoryBlock', async () => {
  const mem = await loadMem(makeStorage());
  const m = mem.loadMemory();
  assert.match(m.persona, /TanyaBukan/);
  const block = mem.buildMemoryBlock();
  assert.match(block, /## MEMORI \/ IDENTITAS/);
  assert.match(block, /TanyaBukan/);
});

test('memory: setMemoryNote persist + diingat saat reload', async () => {
  const storage = makeStorage();
  const mem = await loadMem(storage);
  mem.setMemoryNote('nama', 'Bira');
  assert.equal(mem.getMemoryNote('nama'), 'Bira');
  // Simulasi reload: storage sama, modul baru capture storage yang sama.
  const mem2 = await loadMem(storage);
  assert.equal(mem2.loadMemory().notes.nama, 'Bira');
  const block = mem2.buildMemoryBlock();
  assert.match(block, /CATATAN YANG INGAT/);
  assert.match(block, /Bira/);
});

test('memory: clearMemory reset ke default', async () => {
  const storage = makeStorage();
  const mem = await loadMem(storage);
  mem.setMemoryNote('x', 'y');
  mem.clearMemory();
  assert.equal(mem.getMemoryNote('x'), undefined);
  assert.match(mem.loadMemory().persona, /TanyaBukan/);
});

test('memory: version guard — shape lama & baru + field v tersimpan', async () => {
  const storage = makeStorage();
  // Seed shape LAMA (tanpa 'v') → harus tetap terbaca.
  storage.setItem('tanyabukan.memory', JSON.stringify({ persona: 'LEGACY', notes: { kelas: '12' } }));
  let mem = await loadMem(storage);
  assert.equal(mem.loadMemory().persona, 'LEGACY');
  assert.deepEqual(mem.loadMemory().notes, { kelas: '12' });

  // Simpan shape BARU (dengan 'v') → round-trip + field v === 1.
  mem.saveMemory({ persona: 'BARU', notes: { nama: 'Bira' } });
  const raw = JSON.parse(storage.getItem('tanyabukan.memory'));
  assert.equal(raw.v, 1);
  assert.equal(raw.persona, 'BARU');

  // Reload → tetap terbaca.
  mem = await loadMem(storage);
  assert.equal(mem.loadMemory().persona, 'BARU');
  assert.deepEqual(mem.loadMemory().notes, { nama: 'Bira' });
});
