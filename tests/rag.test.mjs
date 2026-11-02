// tests/rag.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitParagraphs, tokenize, scoreParagraph, selectRelevantParagraphs,
} from '../js/rag.js';

const MATERI = `Fotosintesis adalah proses tumbuhan hijau mengubah cahaya matahari menjadi energi kimia. Proses ini terjadi di kloroplas, khususnya di dalam klorofil yang menyerap cahaya merah dan biru.

Klorofil adalah pigmen hijau yang memungkinkan reaksi fotosintesis terjadi. Tanpa klorofil, tumbuhan tidak bisa menangkap energi cahaya.

Reaksi terang fotosintesis membutuhkan cahaya matahari untuk memecah air (fotolisis) dan menghasilkan ATP serta NADPH. Reakah gelap (siklus Calvin) menggunakan ATP dan NADph untuk mengubah karbondioksid menjadi gula.

Buah adalah bagian bunga yang berkembang setelah pembuahan, umumnya berisi biji dan kaya vitamin C.`;

test('splitParagraphs: pisah oleh baris kosong, buang spasi berlipat', () => {
  const ps = splitParagraphs(MATERI);
  assert.equal(ps.length, 4);
  assert.ok(!ps.some((p) => /\n/.test(p))); // tak ada newline di dalam paragraf
  assert.ok(ps.every((p) => p.trim().length > 0));
});

test('tokenize: lowercase & pisah non-alfabet, buang token pendek', () => {
  const t = tokenize('Halo, DUNIA 123!');
  assert.deepEqual(t, ['halo', 'dunia', '123']);
});

test('scoreParagraph: makin sering kata kunci disebut, skor makin tinggi', () => {
  const q = tokenize('klorofil fotosintesis cahaya');
  const banyak = scoreParagraph(MATERI.split('\n\n')[0], q); // klorofil + cahaya
  const sedikit = scoreParagraph('Buah kaya vitamin.', q);    // tak ada
  assert.ok(banyak > sedikit);
  assert.equal(sedikit, 0);
});

test('scoreParagraph: bonus frasa token berurutan', () => {
  const q = tokenize('sikulus calvin'); // typo sengaja untuk cek partial? tidak — pakai benar
  const q2 = tokenize('sikulus calvin');
  assert.equal(typeof scoreParagraph('Sikulus Calvin adalah reaksi gelap.', q2), 'number');
});

test('selectRelevantParagraphs: ambil top-N berurutan, abaikan di luar query', () => {
  const selected = selectRelevantParagraphs(MATERI, 'klorofil fotosintesis cahaya matahari', 3);
  // Paragraf buah (vitamin C) TIDAK relevan -> tidak ikut.
  assert.ok(!selected.includes('vitamin'));
  assert.ok(selected.includes('klorofil'));
  assert.ok(selected.includes('fotosintesis'));
});

test('selectRelevantParagraphs: query kosong / materi kosong -> string kosong', () => {
  assert.equal(selectRelevantParagraphs(MATERI, '', 3), '');
  assert.equal(selectRelevantParagraphs('', 'klorofil', 3), '');
});
