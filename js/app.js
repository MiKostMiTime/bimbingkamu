// =========================================================
// TanyaBukan — APP
// Entry point: inisialisasi modul, state sesi, event binding.
// =========================================================
import { STORAGE_KEYS, getLevelLabel, migrateLegacyProviderSettings } from './config.js';
import { estimateCost, formatCostIDR, fetchUsdIdr, effectiveUsdIdr, cachedUsdIdr } from './pricing.js';
import { storage } from './storage.js';
import { resolveProviders, listModels, providerChat, probeEndpoint, fetchContextLimit, fetchModelPricing } from './providers.js';
import { needsSummarize, splitForSummary, summarySystemPrompt, summaryMessage, buildContentsFrom } from './summarize.js';
import { selectRelevantParagraphs } from './rag.js';
import { planRedo, applyRedo, planEditRegenerations } from './redo.js';
import { extractPdfText } from './pdf.js';
import { extractDocxText } from './docx.js';
import { buildSystemPrompt, buildOpeningPrompt } from './prompt.js';
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
  customProviderName: $('customProviderName'),
  customProviderKey: $('customProviderKey'),
  addCustomProvider: $('addCustomProvider'),
  connStatus: $('headerConnStatus'),
  webSearchToggle: $('webSearchToggle'),
  timer: $('timerValue'),
  turns: $('turnValue'),
  tokenTotal: $('tokenTotal'),
  priceInput: $('priceInputPer1M'),
  priceOutput: $('priceOutputPer1M'),
  usdIdrInput: $('usdIdrInput'),
  exportBtn: $('exportBtn'),
  chatScroll: $('chatScroll'),
  messages: $('chatMessages'),
  input: $('chatInput'),
  send: $('sendBtn'),
};

// ===== STATE =====
// TIDAK ada provider/model bawaan — keduanya wajib dipilih dari endpoint
// yang dihubungkan user (onboarding / drawer Pengaturan).
const DEFAULT_SETTINGS = { mode: 'konsep', level: 3, model: '', webSearch: true, provider: '', providers: [], usdIdrManual: '' };

// Bersihkan jejak data lama (provider 'gemini', model gemini-*) agar
// onboarding endpoint muncul lagi. Riwayat chat tidak disentuh.
function loadSettings() {
  return migrateLegacyProviderSettings({ ...DEFAULT_SETTINGS, ...storage.get(STORAGE_KEYS.settings, {}) });
}

const state = {
  contextLimit: null, // context window model aktif (dari LM Studio /api/v0) — null bila tak diketahui
  pricing: null, // { input, output, source } per 1M token USD — dari endpoint / input user
  usdIdr: null, // kurs live (cache) — null bila belum tersedia
  apiKey: storage.get(STORAGE_KEYS.apiKey, ''), // kunci umum (fallback bila endpoint tak punya kunci sendiri)
  materiFiles: [], // file sesi AKTIF { name, chars, text } — per chat, bukan global
  settings: loadSettings(),
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
// Setelah endpoint dipilih/ditambahkan, tanyakan model apa yang bisa
// dipakai endpoint itu (SELALU dari endpoint, bukan daftar hardcode),
// lalu segarkan selector model di header chat.
let modelRefreshTimer = null;

function scheduleModelRefresh() {
  if (modelRefreshTimer) clearTimeout(modelRefreshTimer);
  modelRefreshTimer = setTimeout(() => {
    modelRefreshTimer = null;
    refreshProviderModelList();
  }, 800);
}

// Registry provider = endpoint terdaftar user (tanpa bawaan).
function currentProviders() { return resolveProviders(state.settings.providers || []); }

// Kunci aktif: kunci khusus endpoint → fallback kunci umum. Boleh kosong
// (endpoint lokal tanpa auth → request tanpa header Authorization).
function activeApiKey() {
  const p = currentProviders()[state.settings.provider];
  return (p && p.key) || state.apiKey || '';
}

// Guard gabungan: endpoint + model harus terpilih sebelum chat.
function hasActiveChatTarget() {
  return Boolean(state.settings.provider && state.settings.model);
}

function focusChatTarget() {
  if (!state.settings.provider) dom.providerSelect.focus();
  else dom.model.focus();
}

// Indikator status koneksi di header chat.
function updateConnStatus(stateOverride) {
  if (!dom.connStatus) return;
  const s = stateOverride || (state.settings.provider ? 'ok' : 'idle');
  dom.connStatus.classList.remove('is-ok', 'is-error');
  if (s === 'ok') { dom.connStatus.textContent = '● terhubung'; dom.connStatus.classList.add('is-ok'); }
  else if (s === 'error') { dom.connStatus.textContent = '● gagal'; dom.connStatus.classList.add('is-error'); }
  else dom.connStatus.textContent = '● belum ada endpoint';
}

// Isi dropdown model (#modelSelect) berdasarkan endpoint TERPILIH.
// Dipanggil saat load, ganti endpoint, dan setelah hubungkan endpoint.
async function refreshProviderModelList() {
  updateConnStatus(state.settings.provider ? 'ok' : 'idle');
  if (!state.settings.provider) return;
  const provider = currentProviders()[state.settings.provider];
  if (!provider) return;
  try {
    const ids = await listModels(activeApiKey(), provider);
    if (!ids.length) {
      updateConnStatus('error');
      return; // kosong → biarkan pilihan lama
    }
    // Id hanya huruf/angka/titik/tiret (disaring regex di providers.js) → aman
    // untuk disisipkan ke <option>.
    dom.model.innerHTML = ids.map((id) => `<option value="${id}">${id}</option>`).join('');
    dom.model.value = ids.includes(state.settings.model) ? state.settings.model : ids[0];
    state.settings.model = dom.model.value;
    persistSettings();
    updateConnStatus('ok');
    // Context limit (opsional — hanya LM Studio yang melaporkannya).
    fetchContextLimit(provider, activeApiKey(), state.settings.model).then((n) => {
      state.contextLimit = n;
      renderTokenStat(); // persentase konteks di header ikut muncul
    });
    // Harga model (dinamis: input user → LM Studio lokal → OpenRouter live).
    fetchModelPricing(provider, activeApiKey(), state.settings.model).then((pr) => {
      state.pricing = pr;
      renderTokenStat();
    });
    // Kurs USD→IDR (cache 24 jam; manual user menang).
    state.usdIdr = effectiveUsdIdr(state.settings.usdIdrManual);
    if (!state.settings.usdIdrManual) fetchUsdIdr().then((r) => {
      if (r) { state.usdIdr = r; renderTokenStat(); }
    });
  } catch (err) {
    updateConnStatus('error');
    console.warn('[TanyaBukan] gagal memuat daftar model endpoint:', err && err.message);
  }
}

// Isi selector endpoint (#providerSelect di header) dari registry +
// tandai yang terpilih. Registry kosong → placeholder.
function renderProviderOptions() {
  const providers = currentProviders();
  if (!Object.keys(providers).length) {
    dom.providerSelect.innerHTML = '<option value="">Belum ada endpoint</option>';
    return;
  }
  dom.providerSelect.innerHTML = Object.values(providers)
    .map((p) => `<option value="${p.id}" ${p.id === state.settings.provider ? 'selected' : ''}>${p.name}</option>`)
    .join('');
}

// Hubungkan endpoint baru: probe /models vs /v1/models → simpan provider
// (dengan path terverifikasi + kunci opsional) → pilih otomatis → ambil
// daftar model. Return daftar id model (dipakai onboarding). Throw error
// ramah bila endpoint tak merespons.
async function connectEndpoint({ baseUrl, name, key }) {
  const { modelsPath, chatPath } = await probeEndpoint(baseUrl, key);
  const host = baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const id = 'ep-' + Math.random().toString(36).slice(2, 7);
  const provider = {
    id,
    name: name || host || baseUrl,
    baseUrl: baseUrl.trim().replace(/\/+$/, ''),
    modelsPath,
    chatPath,
    key: key || '',
    supportsGrounding: false,
    supportsThinking: false,
    custom: true,
  };
  state.settings.providers = [...(state.settings.providers || []), provider];
  state.settings.provider = id;
  persistSettings();
  renderProviderOptions();
  await refreshProviderModelList();
  dom.customBaseUrl.value = '';
  dom.customProviderName.value = '';
  dom.customProviderKey.value = '';
  showToast(`Endpoint "${provider.name}" terhubung.`, 'success');
  return listModels(activeApiKey(), provider);
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

// Ringkas riwayat otomatis bila prompt terakhir >= 80% context window.
// Mengembalikan isi (contents) baru untuk balasan berikutnya, atau null bila
// tidak diringkas / gagal. Dipakai jalur kirim pesan utama.
async function maybeSummarizeHistory() {
  if (!state.contextLimit) return null; // tak tahu limit -> jangan paksakan
  const stats = sessionStats();
  if (!needsSummarize(stats.lastPrompt, state.contextLimit)) return null;
  const split = splitForSummary(state.messages);
  if (!split) return null;
  try {
    const { text: summary } = await providerChat(state.settings.provider, {
      apiKey: activeApiKey(),
      model: state.settings.model,
      systemPrompt: summarySystemPrompt(),
      contents: buildContentsFrom(split.older),
      thinkingLevel: thinkingLevelFor(),
      grounding: false,
      customProviders: state.settings.providers || [],
    });
    const recent = split.recent;
    state.messages = [summaryMessage(summary), ...recent];
    saveActiveSession();
    showToast('Riwayat diringkas otomatis agar muat konteks.', 'info');
    return buildContentsFrom(state.messages);
  } catch (err) {
    logApiError(err);
    return null; // lanjut normal tanpa ringkasan
  }
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

// Empty state dengan checklist persiapan (kunci API + materi).
function showEmptyState() {
  renderEmptyState(dom.messages, {
    onStart: startFreshSession,
    onOpenSettings: openSettingsPanel,
    status: { keyReady: hasActiveChatTarget(), materiReady: Boolean(buildMateri()) },
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

    // Judul + tanggal dalam satu grup kiri (tak tumpang tindih dengan menu).
    const main = document.createElement('div');
    main.className = 'session-item__main';
    main.append(title, date);

    // Tombol titik-tiga: buka dropdown opsi sesi (Esport / Hapus).
    const menuBtn = document.createElement('button');
    menuBtn.className = 'session-item__menu';
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-label', 'Opsi sesi');
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.innerHTML = MENU_ICON;
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeMenu && activeMenu.btn === menuBtn) closeSessionMenu();
      else openSessionMenu(s, menuBtn);
    });

    const open = () => loadSession(s.id);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    item.append(main, menuBtn);
    dom.sessionList.appendChild(item);
  }
}

// ===== RIWAYAT: MENU TITIK-TIGA (Esport / Hapus) =====
// Dropdown diposisikan `fixed` dari tombol agar tak terpotong overflow sidebar.
let activeMenu = null; // { panel, btn, onDoc, onEsc } yang sedang terbuka

function closeSessionMenu() {
  if (!activeMenu) return;
  const { panel, btn, onDoc, onEsc } = activeMenu;
  panel.remove();
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (onDoc) document.removeEventListener('mousedown', onDoc);
  if (onEsc) document.removeEventListener('keydown', onEsc);
  activeMenu = null;
}

function makeMenuAction(icon, label, onClick, danger = false) {
  const a = document.createElement('button');
  a.className = 'session-item__action' + (danger ? ' --danger' : '');
  a.type = 'button';
  a.setAttribute('role', 'menuitem');
  const iconEl = document.createElement('span');
  iconEl.className = 'session-item__action__icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.innerHTML = icon;
  const labelEl = document.createElement('span');
  labelEl.className = 'session-item__action__label';
  labelEl.textContent = label;
  a.append(iconEl, labelEl);
  a.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSessionMenu();
    onClick();
  });
  return a;
}

function openSessionMenu(session, menuBtn) {
  closeSessionMenu();
  const panel = document.createElement('div');
  panel.className = 'session-item__dropdown';
  panel.setAttribute('role', 'menu');
  // Tenggelam di bawah tombol, rata tepi kanan sidebar.
  const rect = menuBtn.getBoundingClientRect();
  panel.style.top = `${Math.round(rect.bottom) + 4}px`;
  panel.style.right = `${Math.round(window.innerWidth - rect.right) + 8}px`;
  panel.style.left = 'auto';

  // Esport hanya bila sesi punya pesan; Hapus selalu tersedia.
  if ((session.messages || []).length) {
    panel.appendChild(
      makeMenuAction(EXPORT_ICON, 'Esport riwayat', () => exportSession(session))
    );
  }
  panel.appendChild(makeMenuAction(TRASH_ICON, 'Hapus sesi', () => deleteSession(session.id), true));

  document.body.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('is-open'));

  const onDoc = (e) => {
    if (!panel.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) {
      closeSessionMenu();
    }
  };
  const onEsc = (e) => {
    if (e.key === 'Escape') closeSessionMenu();
  };
  document.addEventListener('mousedown', onDoc);
  document.addEventListener('keydown', onEsc);
  activeMenu = { panel, btn: menuBtn, onDoc, onEsc };
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
  if (!hasActiveChatTarget()) return; // belum ada endpoint/model → jangan kirim
  state.busy = true;
  updateComposer();
  const typing = showTyping(dom.messages);
  scrollToEnd(dom.chatScroll, true);
  let built = null;
  try {
    const opening = { role: 'user', text: buildOpeningPrompt(), hidden: true };
    removeTyping(typing);
    // Bubble dibuat sebelum await → token SSE mengalir langsung ke layar.
    const built = addModelMessage(dom.messages);
    let streamed = false;
    const { text: replyText, tokens, sources } = await providerChat(state.settings.provider, {
      apiKey: activeApiKey(),
      model: state.settings.model,
      systemPrompt: buildSystemPrompt({
        materi: buildMateri(),
        mode: state.settings.mode,
        level: state.settings.level,
        webSearch: false,
      }),
      contents: [opening],
      thinkingLevel: thinkingLevelFor(),
      grounding: false,
      customProviders: state.settings.providers || [],
      onDelta: (acc) => { streamed = true; renderRich(built.content, acc); scrollToEnd(dom.chatScroll); },
    });
    const modelMsg = { role: 'model', text: replyText, tokens, sources };
    state.messages.push(opening, modelMsg);
    if (streamed) {
      renderRich(built.content, replyText); // render final (markdown lengkap)
      state.busy = false;
      scrollToEnd(dom.chatScroll);
    } else {
      streamReply(built.content, replyText, built.msg); // fallback: endpoint tanpa SSE
    }
    addRedoButton(built.col, regenerateLast);
  } catch (err) {
    removeTyping(typing);
    state.busy = false;
    if (built) built.msg.remove(); // buang bubble setengah jadi saat stream gagal
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

  if (!hasActiveChatTarget()) {
    showToast('Pilih endpoint & model dulu, ya.', 'info');
    focusChatTarget();
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
  let built = null;
  try {
    // Ringkas riwayat bila mendekati batas konteks (hanya jalur kirim utama).
    const contents = await maybeSummarizeHistory() || buildContents();
    removeTyping(typing);
    // Bubble dibuat sebelum await → token SSE mengalir langsung ke layar.
    built = addModelMessage(dom.messages);
    let streamed = false;
    const { text: reply, tokens, sources } = await providerChat(state.settings.provider, {
      apiKey: activeApiKey(),
      model: state.settings.model,
      systemPrompt: buildSystemPrompt({
        materi: buildMateriFor(text),
        mode: state.settings.mode,
        level: state.settings.level,
        webSearch: state.settings.webSearch,
      }),
      contents,
      thinkingLevel: thinkingLevelFor(),
      grounding: state.settings.webSearch,
      customProviders: state.settings.providers || [],
      onDelta: (acc) => { streamed = true; renderRich(built.content, acc); scrollToEnd(dom.chatScroll); },
    });
    const modelMsg = { role: 'model', text: reply, sources, tokens };
    state.messages.push(modelMsg);
    answered = true;
    if (streamed) {
      renderRich(built.content, reply); // render final (markdown lengkap)
      state.busy = false;
      scrollToEnd(dom.chatScroll);
    } else {
      streamReply(built.content, reply, built.msg); // fallback: endpoint tanpa SSE
    }
    renderSources(built.msg, sources, { onSave: () => saveWebMateri(sources) });
    addRedoButton(built.col, regenerateLast);
  } catch (err) {
    removeTyping(typing);
    state.busy = false;
    if (!answered) {
      // Batalkan giliran yang gagal: riwayat API tetap bergantian rapi,
      // gelembung dibuang, dan ketikan siswa dikembalikan ke kotak input.
      state.messages.pop();
      if (built) built.msg.remove();
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
}

// Regenerasi balasan model terakhir via planRedo → providerChat → rebuild bubble.
async function regenerateLast() {
  if (state.busy) { showToast('Tunggu balasan tutor selesai dulu, ya.', 'info'); return; }
  if (!hasActiveChatTarget()) { showToast('Pilih endpoint & model dulu, ya.', 'info'); focusChatTarget(); return; }
  if (!buildMateri()) { showToast('Lampirkan file materi dulu.', 'error'); openSettingsAndFocus(dom.materiDrop); return; }

  const plan = applyRedo(state.messages, planRedo(state.messages));
  if (!plan) { showToast('Belum ada balasan untuk diregenerasi.', 'info'); return; }

  state.busy = true;
  updateComposer();
  const typing = showTyping(dom.messages);
  scrollToEnd(dom.chatScroll, true);

  try {
    const { text: reply, tokens, sources } = await providerChat(state.settings.provider, {
      apiKey: activeApiKey(),
      model: state.settings.model,
      systemPrompt: buildSystemPrompt({
        materi: buildMateri(),
        mode: state.settings.mode,
        level: state.settings.level,
        webSearch: state.settings.webSearch,
      }),
      contents: plan.contents,
      thinkingLevel: thinkingLevelFor(),
      grounding: state.settings.webSearch,
      customProviders: state.settings.providers || [],
    });
    removeTyping(typing);
    const prev = state.messages[plan.modelIndex];
    // tangkap tokens → simpan ke metadata (footer + updateStats ikut).
    state.messages[plan.modelIndex] = { ...prev, text: reply, sources, tokens };
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
    } else addNotice(dom.messages, m.text, m.role);
  }
}

// EDIT (SUNTING): sunting user pada editIdx → regenerasi berurutan semua balasan
// model setelahnya. Setiap balasan dipanggil ulang lewat providerChat dengan isi
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
      // providerChat → { text, tokens, sources } (path OpenAI-generic). Tangkap token tiap iterasi edit-regen.
      const { text: reply, tokens, sources } = await providerChat(state.settings.provider, {
        apiKey: activeApiKey(), model: state.settings.model, systemPrompt: systemPrompt(),
        contents: reg.contents, thinkingLevel: thinkingLevelFor(),
        grounding: state.settings.webSearch, customProviders: state.settings.providers || [],
      });
      const prev = state.messages[reg.modelIndex];
      // tangkap tokens → simpan ke metadata (footer + updateStats ikut).
      state.messages[reg.modelIndex] = { ...prev, text: reply, sources, tokens };
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
  // Model tersimpan mungkin tak ada lagi di endpoint → biarkan kosong;
  // daftar model disegarkan dari endpoint via refreshProviderModelList().
  const hasSavedModel = [...dom.model.options].some(
    (o) => o.value === state.settings.model
  );
  if (hasSavedModel) dom.model.value = state.settings.model;
  // Harga manual (tersimpan per endpoint) + kurs override.
  const active = currentProviders()[state.settings.provider];
  const pr = active && active.pricing;
  dom.priceInput.value = pr && Number.isFinite(Number(pr.input)) ? pr.input : '';
  dom.priceOutput.value = pr && Number.isFinite(Number(pr.output)) ? pr.output : '';
  dom.usdIdrInput.value = state.settings.usdIdrManual || '';
}

// Simpan harga manual (USD/1M) untuk endpoint aktif + kurs override,
// lalu hitung ulang pricing sesi & statistik header.
function applyPricingInputs() {
  const inP = parseFloat(dom.priceInput.value);
  const outP = parseFloat(dom.priceOutput.value);
  const hasPrice = Number.isFinite(inP) && Number.isFinite(outP) && (inP > 0 || outP > 0);
  const provider = currentProviders()[state.settings.provider];
  if (provider) {
    provider.pricing = hasPrice ? { input: inP, output: outP } : undefined;
    state.settings.providers = (state.settings.providers || []).map((p) =>
      p.id === provider.id ? { ...p, pricing: provider.pricing } : p
    );
  }
  const manual = parseFloat(dom.usdIdrInput.value);
  state.settings.usdIdrManual = Number.isFinite(manual) && manual > 0 ? String(manual) : '';
  persistSettings();
  // Hitung ulang langsung (tanpa menunggu probe ulang endpoint).
  if (hasPrice) state.pricing = { input: inP, output: outP, source: 'manual' };
  else fetchModelPricing(provider, activeApiKey(), state.settings.model).then((pr2) => {
    state.pricing = pr2;
    renderTokenStat();
  });
  state.usdIdr = effectiveUsdIdr(state.settings.usdIdrManual);
  if (!state.settings.usdIdrManual) fetchUsdIdr().then((r) => { if (r) { state.usdIdr = r; renderTokenStat(); } });
  renderTokenStat();
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

// Versi RAG: untuk pertanyaan tertentu, ambil hanya paragraf paling relevan
// dari seluruh materi (bukan isi penuh). Materi tipis / tanpa query tetap
// dikirim utuh. Hasil dipakai sebagai `materi:` di systemPrompt agar model
// fokus pada potongan yang tepat — hemat konteks & biaya.
function buildMateriFor(query) {
  const full = buildMateri();
  if (!full || !query) return full; // tanpa query -> seluruh materi (pembukaan)
  const selected = selectRelevantParagraphs(full, query, 6);
  return selected || full; // fallback: bila tak ada paragraf relevan
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
  return estimateCost(state.pricing, msg.tokens || {});
}

// Ringkasan sesi: token keluar total + token masuk balasan TERAKHIR
// (≈ ukuran konteks yang dikirim ke model saat itu) + biaya.
function sessionStats() {
  const modelMsgs = state.messages.filter((m) => m.role === 'model');
  const totalCompletion = modelMsgs.reduce((n, m) => n + (m.tokens?.completion || 0), 0);
  const lastPrompt = modelMsgs.length ? (modelMsgs[modelMsgs.length - 1].tokens?.prompt || 0) : 0;
  const totalCost = modelMsgs.reduce((n, m) => {
    const c = m.cost ?? computeCost(m);
    return n + (typeof c === 'number' ? c : 0);
  }, 0);
  return { completion: totalCompletion, lastPrompt, cost: totalCost };
}

// Render statistik token di header: "↑ in · ↓ out · $cost" + persentase
// pemakaian context window (bila diketahui dari endpoint). Warna berubah
// saat mendekati batas (≥75% kuning, ≥90% merah).
function renderTokenStat() {
  if (!dom.tokenTotal) return;
  const stats = sessionStats();
  if (!stats.lastPrompt && !stats.completion) {
    dom.tokenTotal.textContent = '—';
    dom.tokenTotal.removeAttribute('style');
    dom.tokenTotal.title = 'Belum ada token tercatat.';
    return;
  }
  const inTok = stats.lastPrompt.toLocaleString('id-ID');
  const outTok = stats.completion.toLocaleString('id-ID');
  let text = `↑ ${inTok} · ↓ ${outTok}`;
  const rate = effectiveUsdIdr(state.settings.usdIdrManual);
  if (typeof stats.cost === 'number' && rate) {
    const rp = formatCostIDR(stats.cost, rate);
    if (rp) text += ` · ~${rp}`; // model lokal → "Rp0"
  }
  dom.tokenTotal.textContent = text;
  dom.tokenTotal.removeAttribute('style');
  let title = '';
  if (state.contextLimit) {
    const pct = Math.round((stats.lastPrompt / state.contextLimit) * 100);
    const warn = pct >= 90 ? '#dc2626' : pct >= 75 ? '#d97706' : null;
    if (warn) dom.tokenTotal.style.color = warn;
    title = `Konteks terpakai ±${pct}% dari ${state.contextLimit.toLocaleString('id-ID')} token model ini (↑ prompt terakhir).`;
  } else {
    title = 'Context limit model tidak dilaporkan endpoint (hanya LM Studio yang menyediakannya).';
  }
  if (state.pricing) {
    title += ` Harga: ${state.pricing.source === 'local' ? 'lokal/gratis' : state.pricing.source === 'manual' ? 'diisi manual' : 'dari endpoint'}`;
    if (rate) {
      title += `; kurs Rp${rate.toLocaleString('id-ID')}/USD`;
      if (state.settings.usdIdrManual) title += ' (manual)';
      else {
        const c = cachedUsdIdr();
        if (c) {
          const menit = Math.round(c.ageMs / 60000);
          title += menit < 1 ? ' (baru saja diperbarui)' : ` (${menit} mnt lalu${c.stale ? ', usang — cari internet untuk perbarui' : ''})`;
        }
      }
      title += '.';
    }
  }
  dom.tokenTotal.title = title;
}

// ===== KURS DINAMIS (refresh berkala) =====
// Estimasi biaya harus konsisten antar pengguna → kurs live dari internet,
// disegarkan tiap 60 detik & saat tab kembali aktif (hemat kuota API).
// Offline/gagal → pakai cache terakhir (ditandai usang di tooltip).
const RATE_REFRESH_MS = 60 * 1000;

function refreshRate() {
  if (state.settings.usdIdrManual) return; // manual user menang — tanpa internet pun tetap konsisten
  fetchUsdIdr().then((r) => {
    if (r) { state.usdIdr = r; renderTokenStat(); }
  });
}

function startRateRefresh() {
  state.usdIdr = effectiveUsdIdr(state.settings.usdIdrManual);
  refreshRate();
  if (startRateRefresh._timer) clearInterval(startRateRefresh._timer);
  startRateRefresh._timer = setInterval(refreshRate, RATE_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshRate();
  });
}

// ===== STATISTIK & STATUS UI =====
function updateStats() {
  setDialogCount(dom.turns, turnCount());
  renderTokenStat();
}

function updateComposer() {
  dom.send.disabled = state.busy || !dom.input.value.trim();
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
  dom.priceInput.addEventListener('change', applyPricingInputs);
  dom.priceOutput.addEventListener('change', applyPricingInputs);
  dom.usdIdrInput.addEventListener('change', applyPricingInputs);
  dom.addCustomProvider.addEventListener('click', () => {
    connectEndpoint({
      baseUrl: dom.customBaseUrl.value,
      name: dom.customProviderName.value.trim(),
      key: dom.customProviderKey.value.trim(),
    }).catch((err) => showToast((err && err.message) || 'Gagal menghubungkan endpoint.', 'error'));
  });

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
  // Ekspor kini menyatu di bar riwayat (renderSessionList). Tombol header lama
  // dihapus; jaga-kompatibilitas bila #exportBtn muncul lagi.
  if (dom.exportBtn) dom.exportBtn.addEventListener('click', exportCurrent);

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
function currentSessionRecord() {
  return state.sessions.find((s) => s.id === state.activeId);
}

// Ekspor sesi (aktif atau spesifik). Mengirim meta + pesan yang tersimpan.
// Tanpa pesan -> tidak melakukan apa-apa. Dipanggil tombol ekspor di bar riwayat.
function exportSession(session) {
  const target = session || currentSessionRecord();
  if (!target || !(target.messages || []).length) return;
  const isCurrent = !session;
  const messages = isCurrent ? state.messages : target.messages;
  exportConversation({
    meta: {
      materi: isCurrent
        ? buildMateri()
        : (target.files || []).map((f) => f.text).join('\n\n'),
      mode: state.settings.mode,
      level: state.settings.level,
      duration: isCurrent ? formatDuration(state.activeMs) : '',
      turns: isCurrent ? turnCount() : messages.length,
      hints: messages.filter((m) => m.kind === 'hint').length,
      model: state.settings.model,
      webSearch: state.settings.webSearch,
    },
    messages,
  });
}

function exportCurrent() {
  exportSession();
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
const MENU_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';
const EXPORT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>';

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

  // Endpoint tersimpan dari sesi lalu → segarkan daftar model dari endpoint itu.
  if (state.settings.provider) refreshProviderModelList();
  else updateConnStatus('idle');
  startRateRefresh(); // kurs live berkala (butuh internet; offline → cache)
  hydrateSidebar();

  if (!storage.get(STORAGE_KEYS.onboardingDone, false)) {
    showOnboarding({
      onConnect: connectEndpoint,
      onModel: (modelId) => {
        if (!modelId) return;
        state.settings.model = modelId;
        persistSettings();
        hydrateSettings();
      },
      onSkip: () => storage.set(STORAGE_KEYS.onboardingDone, true),
      onComplete: () => {
        storage.set(STORAGE_KEYS.onboardingDone, true);
        startFreshSession();
      },
    });
  }
}

init();

// ===== HUKUM UJIAN (test hook) — ekspos alur agar bisa dipanggil dari Node.
// generateGreeting / sendUserMessage = titik masuk alur kirim model; state =
// objek sesi yang dipakai seluruh modul. renderSessionList / exportSession =
// ekspos UI riwayat + ekspor untuk uji integrasi. Hanya tambahan export, tidak
// mengubah aplikasi di browser.
export { generateGreeting, sendUserMessage, state, renderSessionList, exportSession };
