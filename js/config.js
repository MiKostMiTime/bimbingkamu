// =========================================================
// BimbingKamu — KONSTANTA & STORAGE KEYS
// =========================================================

// ===== NAMA & IDENTITAS =====
export const APP_NAME = 'BimbingKamu';

// ===== MODE BELAJAR =====
export const MODES = [
  { id: 'konsep', label: 'Paham Konsep' },
  { id: 'penjelasan', label: 'Penjelasan' },
  { id: 'latihan', label: 'Latihan Soal' },
  { id: 'ujian', label: 'Persiapan Ujian' },
];

// ===== KEADAAN BIMBINGAN (slider 1–5) =====
export const LEVELS = {
  min: 1,
  max: 5,
  labels: {
    1: 'Sangat dibimbing (dijelaskan per langkah)',
    2: 'Cukup dibimbing',
    3: 'Seimbang',
    4: 'Cukup mandiri',
    5: 'Mandiri (lebih langsung)',
  },
};

// ===== PENYIMPANAN (localStorage) =====
// Semua kunci memakai prefiks "bimbingkamu." agar bisa dibersihkan
// tanpa menyentuh data aplikasi lain.
export const STORAGE_KEYS = {
  prefix: 'bimbingkamu.',
  provider: 'bimbingkamu.provider',
  apiKey: 'bimbingkamu.apiKey',
  materiFiles: 'bimbingkamu.materiFiles', // legacy v1 (file global) — dimigrasi ke session.files
  onboardingDone: 'bimbingkamu.onboardingDone',
  settings: 'bimbingkamu.settings',
  session: 'bimbingkamu.session', // legacy v1 — dimigrasi ke `sessions`
  sessions: 'bimbingkamu.sessions',
  activeSession: 'bimbingkamu.activeSession',
  sidebar: 'bimbingkamu.sidebar',
};

// ===== BANTUAN =====
// Cari label mode dari id.
export function getModeLabel(modeId) {
  const mode = MODES.find((m) => m.id === modeId);
  return mode ? mode.label : MODES[0].label;
}

// Cari label level dari nilai slider.
export function getLevelLabel(level) {
  return LEVELS.labels[level] || LEVELS.labels[3];
}

// ===== MIGRASI SETTINGS LAMA =====
// Data sebelum refactor menyimpan provider 'gemini' + model gemini-*.
// Registry kini mulai kosong (semua endpoint ditambahkan user), jadi
// jejak gemini dibersihkan agar onboarding endpoint muncul lagi.
// Riwayat sesi TIDAK disentuh. Murni fungsi — mudah diuji.
export function migrateLegacyProviderSettings(settings = {}) {
  const next = { ...settings };
  if (next.provider === 'gemini') next.provider = '';
  if (typeof next.model === 'string' && /^gemini-/i.test(next.model)) next.model = '';
  if (Array.isArray(next.providers)) {
    next.providers = next.providers.filter((p) => p && p.id !== 'gemini');
  }
  return next;
}

// ===== MIGRASI KUNCI API GLOBAL LAMA → PER-PROVIDER (SATU KALI)
// Latar: storage global `bimbingkamu.apiKey` menyimpan SATU kunci umum yang
// dipakai sebagai fallback bila endpoint tidak punya kunci sendiri. Akibatnya
// kunci OpenRouter lama "bocor" ke provider lain (Gemini/OpenAI/Groq/Anthropic/
// Local AI) → HTTP 403. Fungsi ini memindahkan kunci global ke provider yang
// sebelumnya aktif (best-effort), SATU KALI, lalu penopang global dihapus oleh
// app.js. Murni + stateless: terima settings + legacyKey (+ snapshot id aktif
// pra-bersih) + seedById opsional (DEFAULT_PROVIDERS). Kembali { settings, migrated }.
//   - Jangan timpa kunci yang SUDAH ada di endpoint target (jaga konfigurasi user).
//   - Target = id aktif sebelumnya > provider pertama > OpenRouter (default).
//   - Bila target adalah provider seed (known), override dibuat dari seed penuh
//     agar kind/modelsPath/chatPath/strategy utuh; bila custom tak dikenal → entry minimal.
//   - Provider aktif diarahkan ke target agar endpoint ter-migrasi langsung terpilih.
export function migrateApiKey(settings = {}, legacyKey = '', preActiveId = '', seedById = {}) {
  if (!legacyKey) return { settings: { ...settings }, migrated: false };
  const providers = Array.isArray(settings.providers) ? [...settings.providers] : [];
  let activeId = preActiveId || settings.provider || (providers[0] && providers[0].id) || 'ep-openrouter';
  // Normalisasi id legacy 'gemini' → seed modern agar tidak terhapus saat
  // migrateLegacyProviderSettings membersihkan provider 'gemini'.
  if (activeId === 'gemini') activeId = 'ep-gemini';
  let migrated = false;
  const idx = providers.findIndex((p) => p && p.id === activeId);
  if (idx >= 0) {
    // Jangan timpa kunci yang SUDAH ada di endpoint target.
    if (!providers[idx].key) {
      providers[idx] = { ...providers[idx], key: legacyKey };
      migrated = true;
    }
  } else {
    const seed = seedById[activeId];
    const entry = seed
      ? { ...seed, key: legacyKey, custom: true }
      : { id: activeId, name: activeId, baseUrl: '', key: legacyKey };
    providers.unshift(entry);
    migrated = true;
  }
  return { settings: { ...settings, providers, provider: activeId }, migrated };
}

// Gabung migrasi settings lama + migrasi kunci global dalam satu langkah.
// Snapshot id aktif DIAMBIL SEBELUM migrateLegacyProviderSettings membersihkan
// provider 'gemini'/'ep-gemini', agar kunci bisa diarahkan ke tempat yang benar.
export function migrateLegacyConfig(rawSettings = {}, legacyKey = '', seedById = {}) {
  const preActive = (rawSettings && (rawSettings.provider || (rawSettings.providers && rawSettings.providers[0] && rawSettings.providers[0].id)) || '');
  const migrated = migrateApiKey({ ...rawSettings }, legacyKey, preActive, seedById);
  return migrateLegacyProviderSettings(migrated.settings);
}
