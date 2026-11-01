// =========================================================
// TanyaBukan — KONSTANTA & STORAGE KEYS
// =========================================================

// ===== NAMA & IDENTITAS =====
export const APP_NAME = 'TanyaBukan';

// ===== API GEMINI =====
export const API = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
  // SATU-SATUNYA sumber daftar model (dropdown dibangun dari sini, lihat
  // buildModelOptions di app.js). Model 2.5/2.0/1.5 sudah/akan dimatikan Google.
  // Pilihan aktual disegarkan dari API setelah kunci dipakai (fetchAvailableModels).
  defaultModel: 'gemini-3.8-flash',
  models: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (paling cerdas)' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (seimbang)' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (hemat kuota)' },
  ],
  aistudioUrl: 'https://aistudio.google.com/app/apikey',
};

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
