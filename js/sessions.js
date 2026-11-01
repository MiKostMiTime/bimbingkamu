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

// Segarkan satu objek sesi dari state hidup (murni: objek baru).
export function syncSession(session, { messages, startedAt, files, activeMs }, now = Date.now()) {
  return {
    ...session,
    messages: [...messages],
    files: files ? [...files] : session.files || [],
    startedAt,
    activeMs: activeMs ?? session.activeMs ?? 0,
    title: deriveTitle(messages) || session.title || '',
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
