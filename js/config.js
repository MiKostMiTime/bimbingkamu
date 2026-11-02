// =========================================================
// TanyaBukan — KONSTANTA & STORAGE KEYS
// =========================================================

// ===== NAMA & IDENTITAS =====
export const APP_NAME = 'TanyaBukan';

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
// Semua kunci memakai prefiks "tanyabukan." agar bisa dibersihkan
// tanpa menyentuh data aplikasi lain.
export const STORAGE_KEYS = {
  prefix: 'tanyabukan.',
  provider: 'tanyabukan.provider',
  apiKey: 'tanyabukan.apiKey',
  materiFiles: 'tanyabukan.materiFiles', // legacy v1 (file global) — dimigrasi ke session.files
  onboardingDone: 'tanyabukan.onboardingDone',
  settings: 'tanyabukan.settings',
  session: 'tanyabukan.session', // legacy v1 — dimigrasi ke `sessions`
  sessions: 'tanyabukan.sessions',
  activeSession: 'tanyabukan.activeSession',
  sidebar: 'tanyabukan.sidebar',
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
