// =========================================================
// TanyaBukan — MEMORI
// Simpan anchor identitas + catatan ke localStorage agar chat
// "mengingat" siapa dirinya lintas sesi (reload tetap ingat).
// Ringan, aman (try/catch), dan jalan di Node untuk unit test.
// =========================================================
import { STORAGE_KEYS } from './config.js';

const KEY = `${STORAGE_KEYS.prefix}memory`;

// Versi skema memori yang disimpan ke localStorage. Ditambahkan agar update kode
// tetap bisa membaca data lama (backward-compat) lewat loadMemory().
export const MEMORY_SCHEMA_VERSION = 1;

// localStorage global (browser) atau fallback in-memory (Node / saat nonaktif).
let store = globalThis.localStorage;
function rawGet(key, fallback) {
  try {
    if (store && typeof store.getItem === 'function') {
      const raw = store.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    }
  } catch {}
  return fallback;
}
function rawSet(key, value) {
  try {
    if (store && typeof store.setItem === 'function') {
      store.setItem(key, JSON.stringify(value));
      return true;
    }
  } catch {}
  return false;
}

// Default anchor identitas: ringkasan "siapa dirinya" agar tetap diingat tiap
// sesi baru meski instruksi persona berubah. Diseed otomatis saat pertama kali.
const DEFAULTS = {
  persona: [
    'Kamu adalah TanyaBukan — kakak mentor belajar untuk siswa SMA Indonesia.',
    'Hangat, hidup, dan jago cerita: jelaskan lewat contoh sehari-hari (kelas, PR, kafe), bukan ensiklopedia kaku.',
    'Tujuan: membuat siswa MEMAHAMI (bagan sekadar diuji), lalu bimbing ia menjelaskan ulang dengan kata-katanya sendiri.',
  ].join(' '),
  notes: {},
};

// ===== BACA (seed default bila kosong) =====
export function loadMemory() {
  const saved = rawGet(KEY, null);
  // Backward-compat: data lama disimpan sebagai {persona, notes} tanpa field 'v'.
  const data = (saved && typeof saved.v === 'number')
    ? saved
    : { persona: saved && saved.persona, notes: saved && saved.notes };
  return {
    persona: (data && data.persona) || DEFAULTS.persona,
    notes: { ...(data && data.notes), ...DEFAULTS.notes },
  };
}

// ===== TULIS =====
export function saveMemory(memory) {
  return rawSet(KEY, { v: MEMORY_SCHEMA_VERSION, persona: memory.persona, notes: memory.notes || {} });
}

// ===== CATATAN KECIL (key -> value) — untuk personalisasi lintas sesi =====
export function setMemoryNote(key, value) {
  const memory = loadMemory();
  memory.notes[key] = value;
  return saveMemory(memory);
}

export function getMemoryNote(key) {
  return loadMemory().notes[key];
}

// Reset memori ke default (dipakai saat "hapus semua data").
export function clearMemory() {
  return rawSet(KEY, DEFAULTS);
}

// ===== BLOK MEMORI untuk system prompt (rapi, markdown) =====
// Disisipkan di puncak system prompt agar model mengingat identitas + catatan
// tiap sesi, bukan hanya mengandalkan instruksi persona statik.
export function buildMemoryBlock() {
  const memory = loadMemory();
  const lines = ['## MEMORI / IDENTITAS'];
  if (memory.persona && memory.persona.trim()) lines.push(memory.persona.trim());
  const entries = Object.entries(memory.notes || {}).filter(([, v]) => v && String(v).trim());
  if (entries.length) {
    lines.push('');
    lines.push('### CATATAN YANG INGAT');
    for (const [k, v] of entries) lines.push(`- ${k}: ${String(v).trim()}`);
  }
  return lines.join('\n');
}
