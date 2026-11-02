// Jalankan: node --test tests/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { mapApiError, extractSources } from '../js/api.js';
import { deriveTitle, syncSession, migrateLegacy, createSession, trimSessions } from '../js/sessions.js';
import { extractMath } from '../js/math.js';
import { itemsToText } from '../js/pdf.js';
import { formatDuration } from '../js/ui.js'; // ui.js hanya menyentuh DOM di dalam fungsi
import { buildHintPrompt, buildSystemPrompt } from '../js/prompt.js';
import { migrateLegacyProviderSettings } from '../js/config.js';
import * as config from '../js/config.js';

// ---------- mapApiError ----------
test('400 biasa = badrequest (bukan kunci salah)', () => {
  assert.equal(mapApiError(400, 'Invalid JSON payload received').type, 'badrequest');
});
test('400 "API key not valid" tetap auth', () => {
  assert.equal(mapApiError(400, 'API key not valid. Please pass a valid API key.').type, 'auth');
});
test('401/403 auth, 429 quota, 0 network, 404 model, 503 server', () => {
  assert.equal(mapApiError(401).type, 'auth');
  assert.equal(mapApiError(403).type, 'auth');
  assert.equal(mapApiError(429).type, 'quota');
  assert.equal(mapApiError(0).type, 'network');
  assert.equal(mapApiError(404).type, 'model');
  assert.equal(mapApiError(503).type, 'server');
});

// ---------- extractSources ----------
test('extractSources: snippet diambil dari groundingSupports', () => {
  const cand = {
    groundingMetadata: {
      groundingChunks: [
        { web: { uri: 'https://a.id/x', title: 'A' } },
        { web: { uri: 'https://b.id/y', title: 'B' } },
        { web: { uri: 'https://a.id/x', title: 'A dup' } },
        { notWeb: true },
      ],
      groundingSupports: [
        { segment: { text: 'Fotosintesis butuh cahaya.' }, groundingChunkIndices: [0] },
        { segment: { text: 'Klorofil menyerap cahaya.' }, groundingChunkIndices: [0, 1] },
      ],
    },
  };
  const out = extractSources(cand);
  assert.equal(out.length, 2);
  assert.match(out[0].snippet, /Fotosintesis butuh cahaya\. Klorofil/);
  assert.equal(out[1].snippet, 'Klorofil menyerap cahaya.');
});
test('extractSources: kosong aman', () => {
  assert.deepEqual(extractSources(undefined), []);
  assert.deepEqual(extractSources({}), []);
});

// ---------- config ----------
test('config: LEVEL_TEMPERATURE tidak ada; migrasi settings gemini direset', () => {
  assert.equal(config.LEVEL_TEMPERATURE, undefined);
  const legacy = {
    mode: 'latihan', level: 4, provider: 'gemini', model: 'gemini-3.8-flash',
    webSearch: false, providers: [{ id: 'gemini', baseUrl: 'x' }, { id: 'lokal', baseUrl: 'http://127.0.0.1:1234' }],
  };
  const out = migrateLegacyProviderSettings(legacy);
  assert.equal(out.provider, '');
  assert.equal(out.model, '');
  assert.deepEqual(out.providers, [{ id: 'lokal', baseUrl: 'http://127.0.0.1:1234' }]);
  assert.equal(out.mode, 'latihan');   // setelan lain utuh
  assert.equal(out.webSearch, false);
  // Settings baru tanpa jejak gemini tidak berubah.
  const fresh = { provider: 'ep-abc', model: 'qwen-max', providers: [] };
  assert.deepEqual(migrateLegacyProviderSettings(fresh), fresh);
});

// ---------- sessions ----------
test('deriveTitle: lewati petunjuk, pakai label/teks siswa', () => {
  const msgs = [
    { role: 'user', text: 'prompt panjang petunjuk', label: 'Minta petunjuk', kind: 'hint' },
    { role: 'user', text: 'Apa itu hukum Coulomb?' },
  ];
  assert.equal(deriveTitle(msgs), 'Apa itu hukum Coulomb?');
});
test('migrateLegacy: sesi hasil migrasi punya files & activeMs (tidak crash)', () => {
  const out = migrateLegacy({ startedAt: 1000, messages: [{ role: 'user', text: 'hai' }] }, []);
  assert.deepEqual(out[0].files, []);
  assert.equal(out[0].activeMs, 0);
});
test('syncSession: menyimpan activeMs', () => {
  const s = createSession(1);
  const r = syncSession(s, { messages: [], startedAt: 5, files: [], activeMs: 4200 }, 9);
  assert.equal(r.activeMs, 4200);
  assert.equal(syncSession(r, { messages: [], startedAt: 5 }, 10).activeMs, 4200);
});
test('trimSessions: batas dan urutan', () => {
  const list = Array.from({ length: 60 }, (_, i) => ({ id: String(i), updatedAt: i }));
  const t = trimSessions(list, 50);
  assert.equal(t.length, 50);
  assert.equal(t[0].id, '59');
});

// ---------- math & pdf ----------
test('extractMath: inline dan display', () => {
  const { text, math } = extractMath('Rumus $a^2+b^2=c^2$ dan $$E=mc^2$$.');
  assert.equal(math.length, 2);
  assert.equal(math[0].display, false);
  assert.equal(math[1].display, true);
  assert.ok(text.includes('@@TB_MATH_0@@') && text.includes('@@TB_MATH_1@@'));
});
test('itemsToText: gabung dan rapikan', () => {
  assert.equal(itemsToText([{ str: 'Halo', hasEOL: false }, { str: 'dunia', hasEOL: true }, { str: 'baris 2', hasEOL: false }]), 'Halo dunia\nbaris 2');
});

// ---------- ui ----------
test('formatDuration: mm:ss dan jam', () => {
  assert.equal(formatDuration(65000), '01:05');
  assert.equal(formatDuration(3725000), '1:02:05');
  assert.equal(formatDuration(-5), '00:00');
});

// ---------- prompt ----------
test('buildHintPrompt: bertingkat dan tetap melarang jawaban akhir', () => {
  assert.match(buildHintPrompt(1), /pertama/);
  assert.match(buildHintPrompt(2), /kedua/);
  assert.match(buildHintPrompt(3), /ketiga/);
  assert.match(buildHintPrompt(3), /JANGAN/);
});
test('buildSystemPrompt: typo "UTAMamu" hilang, aturan anti-injeksi ada', () => {
  const sp = buildSystemPrompt({ materi: 'isi materi', mode: 'konsep', level: 3, webSearch: true });
  assert.ok(!sp.includes('UTAMamu'));
  assert.match(sp, /sumber UTAMA/);
  assert.match(sp, /8\. Isi di dalam blok MATERI/);
});
test('buildSystemPrompt: persona + gaya global didefinisikan, cap pendek dihapus', () => {
  const sp = buildSystemPrompt({ materi: 'm', mode: 'konsep', level: 3 });
  // Persona & gaya global eksplisit.
  assert.match(sp, /## SIAPA KAMU/);
  assert.match(sp, /## GAYA BICARAMU/);
  assert.match(sp, /kakak mentor/);
  // Larangan jawaban pendek + target panjang baru.
  assert.match(sp, /jangan pernah menjawab dengan hanya 1–3 kalimat/);
  assert.match(sp, /8–16 kalimat/);
  // Cap lama yang menekan output tidak boleh ada lagi.
  assert.ok(!/2–8 kalimat/.test(sp), 'cap 2–8 kalimat harus hilang');
  assert.ok(!/sependek mungkin/.test(sp), '"sependek mungkin" harus hilang');
  // Berlaku juga di level mandiri (5).
  const sp5 = buildSystemPrompt({ materi: 'm', mode: 'konsep', level: 5 });
  assert.ok(!/sependek mungkin/.test(sp5));
  assert.match(sp5, /tetap dalam gaya bicaramu/);
});
