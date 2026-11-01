// =========================================================
// TanyaBukan — SESSIONS
// Logika murni store sesi (tanpa DOM): buat, judul, urut,
// batasi, migrasi dari format lama. Dipakai app.js.
// =========================================================

export const MAX_SESSIONS = 50;

// Id unik sederhana (tanpa dependensi).
export function newSessionId(now = Date.now()) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSession(now = Date.now()) {
  return {
    id: newSessionId(now),
    title: '',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    messages: [],
    files: [], // lampiran materi sesi ini { name, chars, text } — per chat
    activeMs: 0, // waktu belajar aktif (bukan selisih jam dinding)
  };
}

// Judul = pesan user pertama (dipangkas). Prompt tersembunyi tak dipakai.
export function deriveTitle(messages) {
  const first = (messages || []).find((m) => m.role === 'user' && !m.hidden && m.kind !== 'hint');
  if (!first) return '';
  const t = String(first.label || first.text).replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

// Satukan bentuk pesan (normalize): jamin field metadata token & biaya tetap
// valid, dan buang pesan rusak (tanpa text string). Kembalikan null untuk yang rusak.
export function normalizeMessage(m) {
  if (!m || typeof m.text !== 'string') return null;
  return {
    role: m.role === 'model' ? 'model' : m.role === 'error' ? 'error' : 'user',
    text: m.text,
    hidden: m.hidden === true ? true : undefined,
    label: typeof m.label === 'string' ? m.label : undefined,
    kind: m.kind || undefined,
    model: typeof m.model === 'string' ? m.model : undefined,
    tokens: m.tokens && typeof m.tokens === 'object' ? m.tokens : undefined,
    cost: typeof m.cost === 'number' ? m.cost : undefined,
    sources: Array.isArray(m.sources) ? m.sources : undefined,
  };
}

// Segarkan satu objek sesi dari state hidup (murni: objek baru).
export function syncSession(session, { messages, startedAt, files, activeMs }, now = Date.now()) {
  const normalized = (messages || []).map(normalizeMessage).filter(Boolean);
  return {
    ...session,
    messages: normalized,
    files: files ? [...files] : session.files || [],
    startedAt,
    activeMs: activeMs ?? session.activeMs ?? 0,
    title: deriveTitle(normalized) || session.title || '',
    updatedAt: now,
  };
}

// Urutkan: yang paling baru diperbarui di atas.
export function sortSessions(sessions) {
  return [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Batasi jumlah (sesi terlama terbuang).
export function trimSessions(sessions, max = MAX_SESSIONS) {
  return sortSessions(sessions).slice(0, max);
}

// Gabungkan sesi tunggal versi lama (tanyabukan.session) ke daftar baru.
export function migrateLegacy(legacy, existing) {
  const list = Array.isArray(existing) ? existing : [];
  if (!legacy || !Array.isArray(legacy.messages) || !legacy.messages.length) return list;
  const base = legacy.startedAt || Date.now();
  return [
    {
      id: newSessionId(base),
      title: deriveTitle(legacy.messages),
      createdAt: base,
      updatedAt: base,
      startedAt: legacy.startedAt || null,
      messages: legacy.messages,
      files: [],
      activeMs: 0,
    },
    ...list,
  ];
}
