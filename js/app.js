// =========================================================
// TanyaBukan — APP
// Entry point: inisialisasi modul, state sesi, event binding.
// =========================================================
import { API, STORAGE_KEYS, getLevelLabel } from './config.js';
import { estimateCost, formatCost } from './pricing.js';
import { storage } from './storage.js';
import { callGemini } from './api.js';
import { resolveProviders, listModels } from './providers.js';
import { planRedo, applyRedo, planEditRegenerations } from './redo.js';
import { extractPdfText } from './pdf.js';
import { extractDocxText } from './docx.js';
import { buildSystemPrompt, buildOpeningPrompt, buildHintPrompt } from './prompt.js';
import {
  createSession,
  syncSession,
  sortSessions,
  trimSessions,
  migrateLegacy,
} from './sessions.js';
import {
  addUserMessage,
  addUserMessageWithEdit,
  addModelMessage,
  addNotice,
  showTyping,
  removeTyping,
  streamText,
  clearMessages,
  renderEmptyState,
  removeEmptyState,
  scrollToEnd,
  renderRich,
  renderSources,
  addRedoButton,
  addCostFooter,
  setMateriProvider,
} from './chat.js';
import {
  showToast,
  showConfirm,
  showModal,
  showOnboarding,
  setDialogCount,
  exportConversation,
  clearAllData,
  formatDuration,
  formatRelativeDate,
} from './ui.js';

// ===== REFERENSI DOM =====
const $ = (id) => document.getElementById(id);

const dom = {
  sidebar: $('sidebar'),
  appShell: $('appShell'),
  sidebarBackdrop: $('sidebarBackdrop'),
  historyToggle: $('historyToggle'),
  settingsToggle: $('settingsToggle'),
  settingsPanel: $('settingsPanel'),
  settingsBackdrop: $('settingsBackdrop'),
  settingsClose: $('settingsClose'),
  sessionList: $('sessionList'),
  newSessionBtn: $('newSessionBtn'),
  apiKey: $('apiKeyInput'),
  apiKeyToggle: $('apiKeyToggle'),
  materiDrop: $('materiDrop'),
  materiFile: $('materiFile'),
  materiCount: $('materiCount'),
  materiClear: $('materiClear'),
  materiFileList: $('materiFileList'),
  modeButtons: Array.from(document.querySelectorAll('#modeSegment .segmented__btn')),
  level: $('levelRange'),
  levelValue: $('levelValue'),
  levelDesc: $('levelDesc'),
  model: $('modelSelect'),
  providerSelect: $('providerSelect'),
  customBaseUrl: $('customBaseUrl'),
  customAuthHeader: $('customAuthHeader'),
  addCustomProvider: $('addCustomProvider'),
  webSearchToggle: $('webSearchToggle'),
  timer: $('timerValue'),
  turns: $('turnValue'),
  costTotal: $('costTotal'),
  exportBtn: $('exportBtn'),
  chatScroll: $('chatScroll'),
  messages: $('chatMessages'),
  input: $('chatInput'),
  send: $('sendBtn'),
  hint: $('hintBtn'),
};

// ===== STATE =====
const DEFAULT_SETTINGS = { mode: 'konsep', level: 3, model: API.defaultModel, webSearch: true, provider: 'gemini', providers: [] };

const state = {
  apiKey: storage.get(STORAGE_KEYS.apiKey, ''),
  materiFiles: [], // file sesi AKTIF { name, chars, text } — per chat, bukan global
  settings: { ...DEFAULT_SETTINGS, ...storage.get(STORAGE_KEYS.settings, {}) },
  sessions: [], // riwayat: [{ id, title, createdAt, updatedAt, startedAt, messages }]
  activeId: null, // id sesi yang sedang dibuka
  messages: [], // { role: 'user'|'model'|'system'|'error', text, hidden? }
  startedAt: null,
  activeMs: 0, // waktu belajar aktif (jeda saat idle / tab tersembunyi)
  busy: false,
};

// ===== BANTUAN ERROR =====
// Tampilkan kode HTTP untuk error yang asalnya belum jelas,
// supaya mudah dilaporkan/diagnosis.
function errorDisplayText(err) {
  if (err.status && ['server', 'model', 'unknown', 'badrequest'].includes(err.type)) {
    return `${err.message} (HTTP ${err.status})`;
  }
  return err.message;
}

function logApiError(err) {
  console.error('[TanyaBukan] error API:', err.type, err.status || '', err.apiMessage || '');
}

// ===== DAFTAR MODEL (REFRESH OTOMATIS) =====
// Setelah kunci dimasukkan atau provider dipilih, tanyakan model apa yang
// bisa dipakai endpoint+kunci itu, lalu segarkan selector model. Menjamin
// model yang sudah dinonaktifkan tidak lagi ditawarkan. Gagal diam — daftar
// statis di index.html tetap berlaku. Mengikuti provider yang TERPILIH, bukan
// hanya Gemini (F2: dropdown harus mengikuti provider terpilih).
let modelRefreshTimer = null;

function scheduleModelRefresh() {
  if (modelRefreshTimer) clearTimeout(modelRefreshTimer);
  modelRefreshTimer = setTimeout(() => {
    modelRefreshTimer = null;
    refreshProviderModelList();
  }, 800);
}

// Registry provider = default (Gemini) + custom dari settings.providers.
function currentProviders() { return resolveProviders(state.settings.providers || []); }

// Isi dropdown model (#modelSelect) berdasarkan provider yang TERPILIH.
// Dipanggil saat load, ganti provider, dan ganti kunci → F2: dropdown selalu
// mengikuti provider terpilih, bukan hanya Gemini.
async function refreshProviderModelList() {
  if (!state.apiKey) return;
  const providers = currentProviders();
  const providerId = state.settings.provider || 'gemini';
  const provider = providers[providerId];
  if (!provider) return;
  try {
    const ids = await listModels(state.apiKey, provider);
    if (!ids.length) return; // gagal → biarkan daftar statis
    // Id hanya huruf/angka/titik/tirai (disaring regex di providers.js) → aman
    // untuk disisipkan ke <option>.
    dom.model.innerHTML = ids.map((id) => `<option value="${id}">${id}</option>`).join('');
    dom.model.value = ids.includes(state.settings.model) ? state.settings.model : ids[0];
    state.settings.model = dom.model.value;
    persistSettings();
  } catch (err) {
    console.warn('[TanyaBukan] gagal memuang daftar model provider:', err && err.message);
  }
}

// Isi selector provider (#providerSelect) dari registry + tandai yang terpilih.
function renderProviderOptions() {
  const providers = currentProviders();
  dom.providerSelect.innerHTML = Object.values(providers)
    .map((p) => `<option value="${p.id}" ${p.id === state.settings.provider ? 'selected' : ''}>${p.name}</option>`)
    .join('');
}

// Tambahkan endpoint custom OpenAI-compatible ke registry + pilih otomatis.
function addCustomProvider() {
  const baseUrl = dom.customBaseUrl.value.trim();
  if (!baseUrl) { showToast('Masukkan URL endpoint dulu, ya.', 'info'); return; }
  const id = 'custom-' + Math.random().toString(36).slice(2, 7);
  const provider = {
    id, name: baseUrl, baseUrl,
    authHeader: dom.customAuthHeader.value.trim() || 'Authorization',
    supportsGrounding: false, supportsThinking: false, custom: true,
  };
  state.settings.providers = [...(state.settings.providers || []), provider];
  state.settings.provider = id;
  persistSettings();
  renderProviderOptions();
  refreshProviderModelList();
  dom.customBaseUrl.value = '';
  dom.customAuthHeader.value = '';
  showToast(`Endpoint "${baseUrl}" ditambahkan.`, 'success');
}

// ===== BANTUAN SESI =====
function buildContents() {
  return state.messages
    .filter((m) => m.role === 'user' || m.role === 'model')
    .map((m) => ({ role: m.role, text: m.text }));
}

function turnCount() {
  return state.messages.filter((m) => m.role === 'user' && !m.hidden).length;
}

function isMobile() {
  return window.matchMedia('(max-width: 640px)').matches;
}

// Batas materi: file > 5 MB ditolak; peringatan bila total teks sangat panjang.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const WARN_TOTAL_CHARS = 200000;

// Pengaman data lama yang sudah rusak (mis. pesan model berupa objek).
function cleanMessages(list) {
  return (Array.isArray(list) ? list : []).filter((m) => m && typeof m.text === 'string');
}

// thinking_level: mode Penjelasan butuh penalaran lebih; lainnya cukup rendah.
function thinkingLevelFor() {
  return state.settings.mode === 'penjelasan' ? 'medium' : 'low';
}

// Petunjuk berturut-turut sejak pertanyaan terakhir siswa (untuk petunjuk bertingkat).
function consecutiveHints() {
  let n = 0;
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m.role !== 'user' || m.hidden) continue;
    if (m.kind === 'hint') n += 1;
    else break;
  }
  return n;
}

// Dropdown model dibangun dari config.js (sumber tunggal), bukan hardcode di HTML.
function buildModelOptions() {
  dom.model.innerHTML = API.models
    .map((m) => `<option value="${m.id}">${m.label}</option>`)
    .join('');
}

// Empty state dengan checklist persiapan (kunci API + materi).
function showEmptyState() {
  renderEmptyState(dom.messages, {
    onStart: startFreshSession,
    onOpenSettings: openSettingsPanel,
    status: { keyReady: Boolean(state.apiKey), materiReady: Boolean(buildMateri()) },
  });
}

function refreshEmptyState() {
  if (dom.messages && dom.messages.querySelector('.empty-state')) showEmptyState();
}

// ===== RIWAYAT: SIMPAN =====
// Tulis daftar sesi + pointer sesi aktif. Kuota penuh → kabari,
// jangan biarkan aplikasi pecah.
function persistSessions() {
  const ok = storage.set(STORAGE_KEYS.sessions, state.sessions);
  storage.set(STORAGE_KEYS.activeSession, state.activeId);
  if (!ok) showToast('Penyimpanan browser penuh — riwayat sesi mungkin tidak lengkap.', 'error');
}

// Auto-save sesi aktif tiap giliran + tiap perubahan file lampiran
// (file disimpan di dalam objek sesi). Sesi yang belum punya pesan
// ATAU file (baru diklik "Chat Baru" tapi belum belajar) belum masuk
// daftar; ia muncul di riwayat saat isinya ada.
function saveActiveSession() {
  if (!state.activeId) return;
  storage.set(STORAGE_KEYS.activeSession, state.activeId);
  if (!state.messages.length && !state.materiFiles.length) return;
  const now = Date.now();
  const current = state.sessions.find((s) => s.id === state.activeId);
  const record = syncSession(
    current || { id: state.activeId, title: '', createdAt: now, updatedAt: 0, startedAt: null, messages: [], files: [] },
    { messages: state.messages, startedAt: state.startedAt, files: state.materiFiles },
    now
  );
  state.sessions = current
    ? state.sessions.map((s) => (s.id === record.id ? record : s))
    : [record, ...state.sessions];
  state.sessions = trimSessions(state.sessions);
  persistSessions();
  renderSessionList();
}

// ===== RIWAYAT: DAFTAR =====
function renderSessionList() {
  dom.sessionList.innerHTML = '';
  const list = sortSessions(state.sessions);
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'session-list__empty';
    empty.textContent = 'Belum ada riwayat. Sesi akan muncul di sini setiap kali kamu mulai belajar.';
    dom.sessionList.appendChild(empty);
    return;
  }
  for (const s of list) {
    const item = document.createElement('div');
    item.className = 'session-item';
    if (s.id === state.activeId) item.classList.add('is-active');
    item.setAttribute('role', 'button');
    item.tabIndex = 0;

    const title = document.createElement('span');
    title.className = 'session-item__title';
    title.textContent = s.title || 'Sesi tanpa judul';

    const date = document.createElement('span');
    date.className = 'session-item__date';
    date.textContent = formatRelativeDate(s.updatedAt);

    const del = document.createElement('button');
    del.className = 'session-item__del';
    del.type = 'button';
    del.setAttribute('aria-label', `Hapus sesi: ${title.textContent}`);
    del.innerHTML = TRASH_ICON;
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });

    const open = () => loadSession(s.id);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    item.append(title, date, del);
    dom.sessionList.appendChild(item);
  }
}

// ===== RIWAYAT: HAPUS SATU SESI =====
function deleteSession(id) {
  if (state.busy) {
    showToast('Tunggu balasan tutor selesai dulu, ya.', 'info');
    return;
  }
  const session = state.sessions.find((s) => s.id === id);
  if (!session) return;
  const label = session.title || 'Sesi tanpa judul';
  showConfirm({
    title: 'Hapus sesi ini?',
    text: `"${label}" akan dihapus dari riwayat dan tidak bisa dikembalikan.`,
    confirmLabel: 'Ya, hapus',
    kind: 'danger',
    onConfirm: () => {
      state.sessions = state.sessions.filter((s) => s.id !== id);
      if (id === state.activeId) {
        state.activeId = null; // cegah auto-save menghidupkan kembali sesi yang dihapus
        const next = sortSessions(state.sessions)[0];
        if (next) {
          loadSession(next.id);
        } else {
          state.activeId = null;
          state.messages = [];
          state.materiFiles.length = 0;
          state.startedAt = null;
          state.activeMs = 0;
          clearMessages(dom.messages);
          renderMateriFiles();
          updateMateriCount();
          showEmptyState();
          updateStats();
          updateComposer();
        }
      }
      persistSessions();
      renderSessionList();
      showToast('Sesi dihapus dari riwayat.', 'success');
    },
  });
}

// ===== RIWAYAT: MUAT SESI =====
function loadSession(id) {
  const session = state.sessions.find((s) => s.id === id);
  if (!session || id === state.activeId) return;
  if (state.busy) {
    showToast('Tunggu balasan tutor selesai dulu, ya.', 'info');
    return;
  }
  saveActiveSession(); // simpan dulu sesi yang sedang terbuka (termasuk waktu aktif)
  state.activeId = id;
  state.messages = cleanMessages(session.messages);
  state.materiFiles = [...(session.files || [])];
  state.startedAt = session.startedAt;
  state.activeMs = session.activeMs || 0;
  clearMessages(dom.messages);
  renderMateriFiles();
  updateMateriCount();
  if (state.messages.length) {
    renderMessagesFromState();
    scrollToEnd(dom.chatScroll, true);
  } else {
    state.startedAt = null;
    showEmptyState();
  }
  storage.set(STORAGE_KEYS.activeSession, state.activeId);
  renderSessionList();
  updateStats();
  updateComposer();
  if (isMobile()) closeSidebar();
}

// Render ulang seluruh isi state ke DOM (muat-sesi & restore).
function renderMessagesFromState() {
  for (const m of state.messages) {
    if (m.hidden) continue;
    if (m.role === 'user') {
      addUserMessage(dom.messages, m.label || m.text);
    } else if (m.role === 'model') {
      const { msg, content, col } = addModelMessage(dom.messages);
      renderRich(content, m.text);
      renderSources(msg, m.sources, { onSave: () => saveWebMateri(m.sources) });
      addRedoButton(col, regenerateLast);
      addCostFooter(col, m.tokens, m.cost ?? computeCost(m));
    } else {
      addNotice(dom.messages, m.text, m.role);
    }
  }
}

// ===== SESI =====
function ensureSessionStarted() {
  if (!state.activeId) state.activeId = createSession().id;
  if (!state.startedAt) {
    state.startedAt = Date.now();
    removeEmptyState(dom.messages);
    updateStats();
  }
}

// Isi permulaan sesi aktif: sapaan otomatis (kalau siap) atau
// catatan penunjuk ke drawer Pengaturan.
function startFreshSession() {
  if (!state.activeId) state.activeId = createSession().id;
  state.busy = false; // startedAt diset saat pesan pertama (ensureSessionStarted)
  removeEmptyState(dom.messages);
  updateStats();
  updateComposer();

  if (state.apiKey && buildMateri()) {
    generateGreeting();
    return;
  }
  if (!buildMateri()) {
    addNotice(dom.messages, 'Isi materi di Pengaturan (tombol gear, kanan atas) dulu, ya. Tutor butuh bahan untuk membimbingmu.', 'system');
  } else {
    addNotice(dom.messages, 'Masukkan kunci API di Pengaturan (tombol gear, kanan atas) dulu, ya.', 'system');
  }
  saveActiveSession();
}

// "Chat Baru" dari sidebar. Tanpa dialog konfirmasi — riwayat adalah
// pengamannya: sesi berjalan disimpan dulu dan bisa dibuka lagi.
// Jika sesi sebelumnya punya materi, tawarkan memakainya lagi (tanpa unggah ulang).
function newChat() {
  if (state.busy) {
    showToast('Tunggu balasan tutor selesai dulu, ya.', 'info');
    return;
  }
  saveActiveSession();
  const prevFiles = state.materiFiles.map((f) => ({ ...f }));
  state.messages = [];
  state.materiFiles.length = 0;
  state.startedAt = null;
  state.activeMs = 0;
  state.activeId = createSession().id;
  clearMessages(dom.messages);
  renderMateriFiles();
  updateMateriCount();
  showEmptyState();
  updateStats();
  updateComposer();
  if (isMobile()) closeSidebar();

  if (prevFiles.length) {
    showModal({
      title: 'Pakai materi sebelumnya?',
      text: `Chat sebelumnya punya ${prevFiles.length} file materi. Pakai lagi di chat baru supaya tidak perlu mengunggah ulang?`,
      actions: [
        { label: 'Mulai kosong', kind: 'secondary' },
        {
          label: 'Pakai materi sebelumnya',
          kind: 'primary',
          onClick: () => {
            state.materiFiles = prevFiles;
            renderMateriFiles();
            updateMateriCount();
          },
        },
      ],
      onDismiss: startFreshSession, // jalan setelah pilihan (atau Escape)
    });
  } else {
    startFreshSession();
  }
}

async function generateGreeting() {
  state.busy = true;
  updateComposer();
  const typing = showTyping(dom.messages);
  scrollToEnd(dom.chatScroll, true);
  try {
    const opening = { role: 'user', text: buildOpeningPrompt(), hidden: true };
    // callGemini mengembalikan { text, sources } — ambil .text (bukan objeknya).
    const { text: replyText } = await callGemini({
      apiKey: state.apiKey,
      model: state.settings.model,
      systemPrompt: buildSystemPrompt({
        materi: buildMateri(),
        mode: state.settings.mode,
        level: state.settings.level,
        webSearch: false,
      }),
      contents: [opening],
      thinkingLevel: thinkingLevelFor(),
      webSearch: false,
    });
    removeTyping(typing);
    const modelMsg = { role: 'model', text: replyText };
    state.messages.push(opening, modelMsg);
    const { msg, content, col } = addModelMessage(dom.messages);
    streamReply(content, replyText, msg); // onDone yang melepas busy
    addRedoButton(col, regenerateLast);
    addCostFooter(col, modelMsg.tokens, modelMsg.cost ?? computeCost(modelMsg));
  } catch (err) {
    removeTyping(typing);
    state.busy = false;
    const text = errorDisplayText(err);
    addNotice(dom.messages, text, 'error');
    showToast(text, 'error');
    showRetry();
    logApiError(err);
  } finally {
    updateComposer();
    updateStats();
    saveActiveSession();
  }
}

// Tombol "Coba lagi" saat sapaan gagal — siswa tidak buntu.
function showRetry() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--secondary btn--sm';
  btn.textContent = 'Coba lagi';
  btn.addEventListener('click', () => {
    btn.remove();
    generateGreeting();
  });
  dom.messages.appendChild(btn);
}

// ===== KIRIM PESAN SISWA =====
// opts: { label, kind } — mis. tombol petunjuk menampilkan label singkat
// ("Minta petunjuk") sementara prompt panjangnya hanya dikirim ke model.
async function sendUserMessage(rawText, opts = {}) {
  const fromInput = rawText === undefined;
  const text = (fromInput ? dom.input.value : rawText).trim();
  if (!text || state.busy) return;

  if (!state.apiKey) {
    showToast('Masukkan kunci API dulu, ya.', 'error');
    openSettingsAndFocus(dom.apiKey);
    return;
  }
  if (!buildMateri()) {
    showToast('Lampirkan file materi dulu supaya tutor bisa membimbing dari materimu.', 'error');
    openSettingsAndFocus(dom.materiDrop);
    return;
  }

  ensureSessionStarted();
  if (isMobile()) closeSidebar();

  state.messages.push({ role: 'user', text, label: opts.label, kind: opts.kind });
  // Tangkap index user yang baru pushed; bubble hasil ketik langsung diberi
  // tombol "Sunting" (hanya ini yang bisa disunting — restore riwayat tetap plain).
  const editIdx = state.messages.length - 1;
  const userEl = addUserMessageWithEdit(dom.messages, opts.label || text, {
    onEdit: async (newText) => {
      // Barui teks user di state + bubble, lalu regenerasi ke belakang.
      if (state.messages[editIdx]) state.messages[editIdx].text = newText;
      await regenerateFrom(editIdx);
    },
  });
  if (fromInput) {
    dom.input.value = '';
    autosizeInput();
  }
  scrollToEnd(dom.chatScroll, true);

  state.busy = true;
  updateComposer();
  const typing = showTyping(dom.messages);
  scrollToEnd(dom.chatScroll, true);

  let answered = false;
  try {
    const { text: reply, sources } = await callGemini({
      apiKey: state.apiKey,
      model: state.settings.model,
      systemPrompt: buildSystemPrompt({
        materi: buildMateri(),
        mode: state.settings.mode,
        level: state.settings.level,
        webSearch: state.settings.webSearch,
      }),
      contents: buildContents(),
      thinkingLevel: thinkingLevelFor(),
      webSearch: state.settings.webSearch,
    });
    removeTyping(typing);
    const modelMsg = { role: 'model', text: reply, sources };
    state.messages.push(modelMsg);
    answered = true;
    const { msg, content, col } = addModelMessage(dom.messages);
    streamReply(content, reply, msg); // onDone yang melepas busy
    renderSources(msg, sources, { onSave: () => saveWebMateri(sources) });
    addRedoButton(col, regenerateLast);
    addCostFooter(col, modelMsg.tokens, modelMsg.cost ?? computeCost(modelMsg));
  } catch (err) {
    removeTyping(typing);
    state.busy = false;
    if (!answered) {
      // Batalkan giliran yang gagal: riwayat API tetap bergantian rapi,
      // gelembung dibuang, dan ketikan siswa dikembalikan ke kotak input.
      state.messages.pop();
      userEl.remove();
      if (fromInput) {
        dom.input.value = text;
        autosizeInput();
      }
      if (!state.messages.length) {
        state.startedAt = null;
        showEmptyState();
      }
    }
    const msgText = errorDisplayText(err);
    addNotice(dom.messages, msgText, 'error');
    showToast(msgText, 'error');
    logApiError(err);
  } finally {
    updateComposer();
    updateStats();
    saveActiveSession();
  }
}

// ===== STREAM + TOMBOL LEWATI =====
function streamReply(content, text, msg) {
  const skipBtn = document.createElement('button');
  skipBtn.className = 'btn btn--ghost btn--sm';
  skipBtn.textContent = 'Lewati';
  skipBtn.setAttribute('aria-label', 'Lewati animasi, tampilkan balasan penuh');
  content.parentElement.appendChild(skipBtn);

  scrollToEnd(dom.chatScroll);
  streamText(content, text, {
    skipButton: skipBtn,
    onDone: () => {
      state.busy = false;
      updateComposer();
      scrollToEnd(dom.chatScroll);
    },
  });
}

// ===== REGENERASI BALASAN MODEL (REDO) =====
// Rerender bubble model dari state.messages[idx]: hapus bubble terakhir, lalu
// rebuild dari state. Dipakai tombol "Regenerasi" di setiap bubble tutor.
function rerenderModelMessage(idx) {
  const bubbles = dom.messages.querySelectorAll('.msg--model');
  if (bubbles.length) bubbles[bubbles.length - 1].remove();
  const msg = state.messages[idx];
  if (!msg) return;
  const built = addModelMessage(dom.messages);
  renderRich(built.content, msg.text || '');
  renderSources(built.msg, msg.sources || [], { onSave: () => saveWebMateri(msg.sources || []) });
  addRedoButton(built.col, regenerateLast);
  addCostFooter(built.col, msg.tokens, msg.cost ?? computeCost(msg));
}

// Regenerasi balasan model terakhir via planRedo → callGemini → rebuild bubble.
async function regenerateLast() {
  if (state.busy) { showToast('Tunggu balasan tutor selesai dulu, ya.', 'info'); return; }
  if (!state.apiKey) { showToast('Masukkan kunci API dulu, ya.', 'error'); openSettingsAndFocus(dom.apiKey); return; }
  if (!buildMateri()) { showToast('Lampirkan file materi dulu.', 'error'); openSettingsAndFocus(dom.materiDrop); return; }

  const plan = applyRedo(state.messages, planRedo(state.messages));
  if (!plan) { showToast('Belum ada balasan untuk diregenerasi.', 'info'); return; }

  state.busy = true;
  updateComposer();
  const typing = showTyping(dom.messages);
  scrollToEnd(dom.chatScroll, true);

  try {
    const { text: reply, sources } = await callGemini({
      apiKey: state.apiKey,
      model: state.settings.model,
      systemPrompt: buildSystemPrompt({
        materi: buildMateri(),
        mode: state.settings.mode,
        level: state.settings.level,
        webSearch: state.settings.webSearch,
      }),
      contents: plan.contents,
      thinkingLevel: thinkingLevelFor(),
      webSearch: state.settings.webSearch,
    });
    removeTyping(typing);
    const prev = state.messages[plan.modelIndex];
    // cost = undefined sementara (Task 8); metadata lain ikut.
    state.messages[plan.modelIndex] = { ...prev, text: reply, sources };
    rerenderModelMessage(plan.modelIndex);
    state.busy = false; // <-- PENTING: reset di jalur sukses agar tidak mengunci composer
  } catch (err) {
    removeTyping(typing);
    state.busy = false;
    const text = errorDisplayText(err);
    addNotice(dom.messages, text, 'error');
    showToast(text, 'error');
    logApiError(err);
  } finally {
    updateComposer();
    saveActiveSession();
  }
}

// ===== RERENDER BUBBLE MODEL DARI SUATU TITIK (EDIT) =====
// MVP: barikan seluruh bubble chat, lalu render ulang seluruh state.messages dari
// startIdx ke akhir. Setiap bubble model dibangun ulang lengkap (teks + sumber +
// tombol "Regenerasi" Task 3), sehingga sunting pesan menjaga konsistensi UI.
function rerenderModelMessagesFrom(startIdx) {
  clearMessages(dom.messages);
  for (const m of state.messages) {
    if (m.hidden) continue;
    if (m.role === 'user') addUserMessage(dom.messages, m.label || m.text);
    else if (m.role === 'model') {
      const built = addModelMessage(dom.messages);
      renderRich(built.content, m.text || '');
      renderSources(built.msg, m.sources || [], { onSave: () => saveWebMateri(m.sources || []) });
      addRedoButton(built.col, regenerateLast);
      addCostFooter(built.col, m.tokens, m.cost ?? computeCost(m));
    } else addNotice(dom.messages, m.text, m.role);
  }
}

// EDIT (SUNTING): sunting user pada editIdx → regenerasi berurutan semua balasan
// model setelahnya. Setiap balasan dipanggil ulang lewat callGemini dengan isi
// berjalan (lihat planEditRegenerations), lalu bubble-nya dire-render sekaligus.
async function regenerateFrom(editIdx) {
  if (state.busy) { showToast('Tunggu balasan tutor selesai dulu, ya.', 'info'); return; }
  const regs = planEditRegenerations(state.messages, editIdx);
  if (!regs.length) { showToast('Tidak ada balasan untuk diregenerasi.', 'info'); return; }

  state.busy = true;
  updateComposer();
  scrollToEnd(dom.chatScroll, true);

  // systemPrompt diambil ulang tiap panggilan agar selalu sesuai setting terkini.
  const systemPrompt = () => buildSystemPrompt({
    materi: buildMateri(), mode: state.settings.mode,
    level: state.settings.level, webSearch: state.settings.webSearch,
  });

  try {
    for (const reg of regs) {
      // callGemini → { text, sources } (tanpa token); param webSearch, bukan grounding.
      const { text: reply, sources } = await callGemini({
        apiKey: state.apiKey, model: state.settings.model, systemPrompt: systemPrompt(),
        contents: reg.contents, thinkingLevel: thinkingLevelFor(), webSearch: state.settings.webSearch,
      });
      const prev = state.messages[reg.modelIndex];
      // cost = undefined sementara (Task 8); text + sources ikut.
      state.messages[reg.modelIndex] = { ...prev, text: reply, sources };
    }
    rerenderModelMessagesFrom(editIdx);
    state.busy = false;   // <-- reset di jalur sukses (poin penting)
  } catch (err) {
    state.busy = false;   // <-- reset juga di jalur error
    const text = errorDisplayText(err);
    addNotice(dom.messages, text, 'error');
    showToast(text, 'error');
    logApiError(err);
  } finally {
    updateComposer();
    saveActiveSession();
  }
}

// ===== DRAWER PENGATURAN (kanan) =====
function openSettingsPanel() {
  dom.settingsPanel.classList.add('is-open');
  dom.settingsBackdrop.classList.add('is-open');
  dom.settingsToggle.setAttribute('aria-expanded', 'true');
  if (isMobile()) closeSidebar();
  dom.settingsClose.focus(); // fokus pindah ke dalam drawer
}

function closeSettingsPanel() {
  dom.settingsPanel.classList.remove('is-open');
  dom.settingsBackdrop.classList.remove('is-open');
  dom.settingsToggle.setAttribute('aria-expanded', 'false');
  dom.settingsToggle.focus();
}

function toggleSettingsPanel() {
  if (dom.settingsPanel.classList.contains('is-open')) closeSettingsPanel();
  else openSettingsPanel();
}

// Fokus ke field setting — dipakai saat kunci/materi belum diisi.
function openSettingsAndFocus(field) {
  openSettingsPanel();
  field.focus();
  field.scrollIntoView({ block: 'center' });
}

// ===== PANEL RIWAYAT (sidebar) MOBILE =====
function closeSidebar() {
  dom.sidebar.classList.remove('is-open');
  dom.sidebarBackdrop.classList.remove('is-open');
  dom.historyToggle.setAttribute('aria-expanded', 'false');
}

// ===== INPUT =====
function autosizeInput() {
  dom.input.style.height = 'auto';
  dom.input.style.height = `${Math.min(dom.input.scrollHeight, 160)}px`;
}

// ===== HIDRASI UI DARI STATE =====
function hydrateSettings() {
  buildModelOptions();
  renderProviderOptions();
  dom.apiKey.value = state.apiKey;
  updateMateriCount();
  renderMateriFiles();
  dom.modeButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.settings.mode));
  });
  dom.level.value = String(state.settings.level);
  updateLevelLabel();
  dom.webSearchToggle.checked = state.settings.webSearch !== false;
  // Model yang tersimpan mungkin sudah dinonaktifkan Google (mis.
  // gemini-2.0-flash kini mati) → sinkronkan ke opsi yang masih ada.
  const hasSavedModel = [...dom.model.options].some(
    (o) => o.value === state.settings.model
  );
  dom.model.value = hasSavedModel ? state.settings.model : dom.model.options[0].value;
  if (state.settings.model !== dom.model.value) {
    state.settings.model = dom.model.value;
    persistSettings();
  }
}

function updateMateriCount() {
  const total = state.materiFiles.reduce((n, f) => n + f.chars, 0);
  const tok = Math.ceil(total / 4);
  dom.materiCount.textContent = `${total.toLocaleString('id-ID')} karakter (±${tok.toLocaleString('id-ID')} token)`;
}

// ===== MATERI: FILE TERLAMPIR (per sesi) =====
// Teks hasil ekstraksi tidak pernah ditampilkan di panel (bisa ribuan
// karakter yang hanya menggangu pandangan); file tampil sebagai chip,
// dan teksnya tetap ikut dikirim ke model sebagai bagian materi.
// File disimpan di dalam objek sesi (session.files), spesifik per chat.
function buildMateri() {
  const parts = state.materiFiles.map((f) => f.text)
    .map((t) => t.trim())
    .filter(Boolean);
  return parts.join('\n\n');
}

function renderMateriFiles() {
  const box = dom.materiFileList;
  box.hidden = !state.materiFiles.length;
  box.innerHTML = '';
  state.materiFiles.forEach((f, i) => {
    const chip = document.createElement('li');
    chip.className = 'file-chip';

    const name = document.createElement('span');
    name.className = 'file-chip__name';
    name.textContent = f.name;

    const meta = document.createElement('span');
    meta.className = 'file-chip__meta';
    meta.textContent = `${f.chars.toLocaleString('id-ID')} karakter · ±${Math.ceil(f.chars / 4).toLocaleString('id-ID')} token`;

    const del = document.createElement('button');
    del.className = 'file-chip__del';
    del.type = 'button';
    del.setAttribute('aria-label', `Lepas file ${f.name}`);
    del.innerHTML = X_ICON;
    del.addEventListener('click', () => removeMateriFile(i));

    chip.append(name, meta, del);
    box.appendChild(chip);
  });
  refreshEmptyState(); // checklist di empty state ikut diperbarui
}

function removeMateriFile(index) {
  const [removed] = state.materiFiles.splice(index, 1);
  saveActiveSession();
  renderMateriFiles();
  updateMateriCount();
  if (removed) showToast(`"${removed.name}" dilepas dari materi.`, 'info');
}

// Sumber web (grounding) disimpan sebagai satu "file" virtual di materi
// sesi: ikut buildMateri, tampil sebagai chip yang bisa dilepas.
function saveWebMateri(sources) {
  if (!sources || !sources.length) return;
  const name = 'web-rujukan.md';
  if (state.materiFiles.some((f) => f.name === name)) {
    showToast('Sumber web sudah tersimpan di materi.', 'info');
    return;
  }
  const text = sources
    .map((s) => `### ${s.title || s.url}\nURL: ${s.url}\n${s.snippet}`)
    .join('\n\n');
  state.materiFiles.push({ name, chars: text.length, text });
  saveActiveSession();
  renderMateriFiles();
  updateMateriCount();
  showToast('Sumber web disimpan ke materi sesi.', 'success');
}

function updateLevelLabel() {
  const level = Number(dom.level.value);
  dom.levelValue.textContent = String(level);
  dom.levelDesc.textContent = getLevelLabel(level);
}

// ===== HITUNG BIAYA =====
// Biaya estimasi satu pesan model dari token keluarnya (completion) pada model
// aktif. estimateCost mengembalikan null bila harga model belum diketahui.
function computeCost(msg) {
  return estimateCost(state.settings.model, msg.tokens || {});
}

// Ringkasan total sesi: seluruh pesan model → jumlah token completion + total biaya.
function sessionStats() {
  const modelMsgs = state.messages.filter((m) => m.role === 'model');
  const totalCompletion = modelMsgs.reduce((n, m) => n + (m.tokens?.completion || 0), 0);
  const totalCost = modelMsgs.reduce((n, m) => {
    const c = m.cost ?? computeCost(m);
    return n + (typeof c === 'number' ? c : 0);
  }, 0);
  return { completion: totalCompletion, cost: totalCost };
}

// ===== STATISTIK & STATUS UI =====
function updateStats() {
  setDialogCount(dom.turns, turnCount());
  dom.exportBtn.disabled = !state.messages.length;
  const stats = sessionStats();
  dom.costTotal.textContent = formatCost(stats.cost);
}

function updateComposer() {
  dom.send.disabled = state.busy || !dom.input.value.trim();
  dom.hint.disabled = state.busy || !state.messages.length;
}

// ===== RESTORE (awal aplikasi) =====
function restoreSession() {
  let sessions = storage.get(STORAGE_KEYS.sessions, []);
  if (!Array.isArray(sessions)) sessions = [];

  // Migrasi sekali: sesi tunggal versi lama → daftar baru.
  const legacy = storage.get(STORAGE_KEYS.session, null);
  if (legacy) {
    sessions = migrateLegacy(legacy, sessions);
    storage.remove(STORAGE_KEYS.session); // format lama tak dipakai lagi
    state.sessions = trimSessions(sessions);
    persistSessions();
  } else {
    state.sessions = trimSessions(sessions);
  }

  const savedActive = storage.get(STORAGE_KEYS.activeSession, null);
  const active = state.sessions.find((s) => s.id === savedActive) || null;
  state.activeId = active ? active.id : null;

  // Migrasi sekali: file materi global versi lama → sesi aktif (atau
  // sesi terbaru). Mulai sekarang file tersimpan per sesi (session.files).
  const legacyFiles = storage.get(STORAGE_KEYS.materiFiles, null);
  if (Array.isArray(legacyFiles) && legacyFiles.length) {
    const target = active || (state.sessions.length ? state.sessions[0] : null);
    if (target && !(target.files || []).length) target.files = legacyFiles;
    if (target) persistSessions();
    storage.remove(STORAGE_KEYS.materiFiles);
  }
  state.materiFiles = active ? [...(active.files || [])] : [];
  state.activeMs = active ? active.activeMs || 0 : 0;

  const restored = active ? cleanMessages(active.messages) : [];
  if (restored.length) {
    state.messages = restored;
    state.startedAt = active.startedAt;
    clearMessages(dom.messages);
    renderMessagesFromState();
    scrollToEnd(dom.chatScroll, true);
  } else {
    showEmptyState();
  }
  renderSessionList();
  renderMateriFiles();
  updateMateriCount();
}

// ===== HAPUS SEMUA =====
function resetAll() {
  clearAllData(); // semua kunci tanyabukan.* — termasuk sessions & activeSession
  state.apiKey = '';
  state.materiFiles.length = 0;
  state.settings = { ...DEFAULT_SETTINGS };
  state.sessions = [];
  state.activeId = null;
  state.messages = [];
  state.startedAt = null;
  state.activeMs = 0;
  state.busy = false;
  hydrateSettings();
  clearMessages(dom.messages);
  showEmptyState();
  renderSessionList();
  updateStats();
  updateComposer();
  showToast('Semua data TanyaBukan telah dihapus dari browser ini.', 'success');
}

// ===== MATERI: TERIMA FILE =====
// Dipakai oleh jalur drag & drop dan dialog file.
async function ingestMateriFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    showToast(`"${file.name}" terlalu besar (maks. 5 MB). Pecah file atau salin bagian pentingnya ke .txt/.md.`, 'error');
    return;
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isDocx =
    file.type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(file.name);
  try {
    const text = isPdf
      ? await extractPdfText(file)
      : isDocx
        ? await extractDocxText(file)
        : await file.text();
    if (!text.trim()) {
      showToast('File tersebut tidak berisi teks terbaca.', 'error');
      return;
    }
    // Pastikan ada sesi aktif supaya file tersimpan walau halaman di-reload sebelum chat dimulai.
    if (!state.activeId) state.activeId = createSession().id;
    state.materiFiles.push({ name: file.name, chars: text.length, text });
    saveActiveSession(); // file disimpan di dalam objek sesi
    renderMateriFiles();
    updateMateriCount();
    showToast(`"${file.name}" berhasil dilampirkan.`, 'success');
    const totalChars = state.materiFiles.reduce((n, f) => n + f.chars, 0);
    if (totalChars > WARN_TOTAL_CHARS) {
      showToast(`Materi sangat panjang (±${Math.ceil(totalChars / 4).toLocaleString('id-ID')} token). Balasan bisa lebih lambat dan penyimpanan browser cepat penuh.`, 'info');
    }
  } catch (err) {
    // Error ramah = objek { type, message } yang kita lempar sendiri.
    console.error('[TanyaBukan] unggah materi gagal:', err);
    const msg = err && err.type
      ? err.message
      : 'File tidak bisa dibaca. Coba file .txt, .md, .pdf, atau .docx lain.';
    showToast(msg, 'error');
  }
}

// ===== SIDEBAR RIWAYAT: RATAKAN (layar lebar) =====
// Di layar lebar tombol header meratakan sidebar (bukan drawer);
// keadaannya tersimpan supaya konsisten antar kunjungan.
function toggleHistoryCollapsed() {
  const collapsed = dom.appShell.classList.toggle('is-collapsed');
  syncHistoryToggleAria(collapsed);
  storage.set(STORAGE_KEYS.sidebar, collapsed ? 'collapsed' : 'open');
}

function syncHistoryToggleAria(collapsed) {
  dom.historyToggle.setAttribute('aria-expanded', String(!collapsed));
  dom.historyToggle.setAttribute(
    'aria-label',
    collapsed ? 'Buka riwayat chat' : 'Tutup riwayat chat'
  );
}

function hydrateSidebar() {
  const collapsed = storage.get(STORAGE_KEYS.sidebar, 'open') === 'collapsed';
  dom.appShell.classList.toggle('is-collapsed', collapsed);
  // Di HP sidebar = drawer yang tertutup saat awal.
  syncHistoryToggleAria(isMobile() ? true : collapsed);
}

// ===== EVENT BINDING =====
function bindEvents() {
  // BYOK
  dom.apiKey.addEventListener('input', () => {
    state.apiKey = dom.apiKey.value.trim();
    storage.set(STORAGE_KEYS.apiKey, state.apiKey);
    scheduleModelRefresh();
    refreshEmptyState();
  });

  // PROVIDER: ganti provider → segarkan dropdown model + render ulang opsi.
  dom.providerSelect.addEventListener('change', () => {
    state.settings.provider = dom.providerSelect.value;
    persistSettings();
    renderProviderOptions();
    refreshProviderModelList();
  });
  dom.addCustomProvider.addEventListener('click', addCustomProvider);

  dom.apiKeyToggle.addEventListener('click', () => {
    const show = dom.apiKey.type === 'password';
    dom.apiKey.type = show ? 'text' : 'password';
    dom.apiKeyToggle.setAttribute('aria-label', show ? 'Sembunyikan kunci' : 'Tampilkan kunci');
    dom.apiKeyToggle.innerHTML = show ? EYE_OFF : EYE;
  });

  // Hapus semua data
  $('deleteAllBtn').addEventListener('click', () => {
    showConfirm({
      title: 'Hapus semua data?',
      text: 'Kunci API, materi, pengaturan, dan riwayat sesi akan dihapus dari browser ini. Tindakan ini tidak bisa dibatalkan.',
      confirmLabel: 'Ya, hapus semua',
      kind: 'danger',
      onConfirm: resetAll,
    });
  });

  // Materi: drag & drop (klik / Enter / Space juga membuka dialog file)
  const dropzone = dom.materiDrop;
  dropzone.addEventListener('click', () => dom.materiFile.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dom.materiFile.click();
    }
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault(); // cegah browser membuka file-nya
      dropzone.classList.add('dropzone--active');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dropzone--active');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    ingestMateriFile(file);
  });
  dom.materiFile.addEventListener('change', () => {
    const file = dom.materiFile.files[0];
    // Reset dulu supaya file yang sama bisa diunggah ulang.
    dom.materiFile.value = '';
    ingestMateriFile(file);
  });
  dom.materiClear.addEventListener('click', () => {
    if (!state.materiFiles.length) return;
    showConfirm({
      title: 'Bersihkan materi?',
      text: 'Semua file terlampir pada sesi ini akan dihapus.',
      confirmLabel: 'Ya, bersihkan',
      kind: 'danger',
      onConfirm: () => {
        state.materiFiles.length = 0;
        saveActiveSession();
        renderMateriFiles();
        updateMateriCount();
        showToast('Materi telah dibersihkan.', 'success');
      },
    });
  });

  // Pengaturan
  dom.modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.settings.mode = btn.dataset.mode;
      persistSettings();
      dom.modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });
  dom.level.addEventListener('input', () => {
    state.settings.level = Number(dom.level.value);
    persistSettings();
    updateLevelLabel();
  });
  dom.model.addEventListener('change', () => {
    state.settings.model = dom.model.value;
    persistSettings();
  });
  dom.webSearchToggle.addEventListener('change', () => {
    state.settings.webSearch = dom.webSearchToggle.checked;
    persistSettings();
  });

  // Chat
  dom.input.addEventListener('input', () => {
    autosizeInput();
    updateComposer();
  });
  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendUserMessage();
    }
  });
  dom.send.addEventListener('click', () => sendUserMessage());
  // Petunjuk bertingkat: makin sering berturut-turut, makin spesifik (tanpa jawaban akhir).
  dom.hint.addEventListener('click', () =>
    sendUserMessage(buildHintPrompt(consecutiveHints() + 1), { label: 'Minta petunjuk', kind: 'hint' })
  );
  dom.exportBtn.addEventListener('click', exportCurrent);

  // Riwayat: toggle sidebar (HP = drawer, layar lebar = ratakan)
  dom.historyToggle.addEventListener('click', () => {
    if (isMobile()) {
      const open = dom.sidebar.classList.toggle('is-open');
      dom.sidebarBackdrop.classList.toggle('is-open', open);
      dom.historyToggle.setAttribute('aria-expanded', String(open));
    } else {
      toggleHistoryCollapsed();
    }
  });
  dom.sidebarBackdrop.addEventListener('click', closeSidebar);

  // Pengaturan: drawer kanan
  dom.settingsToggle.addEventListener('click', toggleSettingsPanel);
  dom.settingsClose.addEventListener('click', closeSettingsPanel);
  dom.settingsBackdrop.addEventListener('click', closeSettingsPanel);
  // Focus trap sederhana di drawer pengaturan.
  dom.settingsPanel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = Array.from(
      dom.settingsPanel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.settingsPanel.classList.contains('is-open')) closeSettingsPanel();
  });

  // Chat baru (sidebar) — tanpa konfirmasi; riwayat adalah pengamannya.
  dom.newSessionBtn.addEventListener('click', newChat);
}

function persistSettings() {
  storage.set(STORAGE_KEYS.settings, state.settings);
}

// ===== EKSPOR SAAT INI =====
function exportCurrent() {
  if (!state.messages.length) return;
  exportConversation({
    meta: {
      materi: buildMateri(),
      mode: state.settings.mode,
      level: state.settings.level,
      duration: formatDuration(state.activeMs),
      turns: turnCount(),
      hints: state.messages.filter((m) => m.kind === 'hint').length,
      model: state.settings.model,
      webSearch: state.settings.webSearch,
    },
    messages: state.messages,
  });
}

// ===== IKON =====
const EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.7 17.7 0 0 0 2 12s3.5 7 10 7a10.6 10.6 0 0 0 3.4-.6"/></svg>';
const TRASH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6"/></svg>';
const X_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>';

// ===== TIMER WAKTU AKTIF =====
// Hanya bertambah bila ada pesan, tab terlihat, dan ada aktivitas dalam 60 dtk
// terakhir. Membuka sesi lama tidak lagi menampilkan selisih jam dinding.
function startActiveTimer() {
  let lastTick = Date.now();
  let lastActivity = Date.now();
  ['keydown', 'pointerdown', 'input'].forEach((ev) =>
    document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true })
  );
  const tick = () => {
    const now = Date.now();
    const idle = now - lastActivity > 60000;
    if (state.messages.length && document.visibilityState === 'visible' && !idle) {
      state.activeMs += Math.min(now - lastTick, 5000);
    }
    lastTick = now;
    dom.timer.textContent = formatDuration(state.activeMs);
  };
  tick();
  setInterval(tick, 1000);
  // Simpan waktu aktif saat halaman ditutup/disembunyikan.
  window.addEventListener('pagehide', saveActiveSession);
}

// ===== INIT =====
function init() {
  setMateriProvider(buildMateri); // verifikasi sitasi [[...]] terhadap materi
  hydrateSettings();
  restoreSession();
  updateStats();
  updateComposer();
  startActiveTimer();
  bindEvents();

  // Kunci tersimpan dari sesi lalu → segarkan daftar model sesuai provider terpilih.
  if (state.apiKey) refreshProviderModelList();
  hydrateSidebar();

  if (!storage.get(STORAGE_KEYS.onboardingDone, false)) {
    showOnboarding({
      onSkip: () => storage.set(STORAGE_KEYS.onboardingDone, true),
      onComplete: () => {
        storage.set(STORAGE_KEYS.onboardingDone, true);
        startFreshSession();
      },
    });
  }
}

init();
