// =========================================================
// TanyaBukan — UI
// Modal, toast, onboarding, timer, statistik, ekspor.
// =========================================================
import { storage } from './storage.js';
import { getModeLabel, getLevelLabel } from './config.js';

// ===== IKON (inline SVG) =====
const ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

// ===== TOAST =====
// Tampilkan notifikasi pojok; auto-hilang 3,5 detik (error 8 detik).
export function showToast(message, type = 'info') {
  const region = document.getElementById('toastRegion');
  if (!region) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<span class="toast__icon" aria-hidden="true">${ICONS[type] || ICONS.info}</span>`;
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  region.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 200);
  };
  // Error perlu waktu lebih lama untuk dibaca.
  setTimeout(dismiss, type === 'error' ? 8000 : 3500);
}

// ===== MODAL =====
// Fokus sederhana (trap) + tutup via Escape & overlay.
export function showModal({ title, text, actions = [], onDismiss, closeLabel = 'Tutup' }) {
  const root = document.getElementById('modalRoot');
  const previousFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'tb-modal-title');

  const header = document.createElement('div');
  header.className = 'modal__header';
  const h = document.createElement('h2');
  h.id = 'tb-modal-title';
  h.className = 'modal__title';
  h.textContent = title;
  header.appendChild(h);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal__close';
  closeBtn.setAttribute('aria-label', closeLabel);
  closeBtn.innerHTML = ICONS.close;
  header.appendChild(closeBtn);
  modal.appendChild(header);

  if (text) {
    const lines = Array.isArray(text) ? text : [text];
    lines.forEach((line) => {
      const p = document.createElement('p');
      p.className = 'modal__text';
      p.textContent = line;
      modal.appendChild(p);
    });
  }

  const bar = document.createElement('div');
  bar.className = 'modal__actions';
  const buttons = [];
  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.className = `btn btn--${action.kind || 'secondary'}`;
    btn.textContent = action.label;
    if (action.primary) btn.classList.add('btn--primary');
    btn.addEventListener('click', () => {
      if (action.onClick) action.onClick();
      if (!action.keepOpen) close();
    });
    bar.appendChild(btn);
    buttons.push(btn);
  });
  modal.appendChild(bar);

  overlay.appendChild(modal);
  root.appendChild(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (previousFocus && previousFocus.focus) previousFocus.focus();
    if (onDismiss) onDismiss();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') trapFocus(e);
  }

  function trapFocus(e) {
    const focusables = modal.querySelectorAll(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const list = Array.from(focusables);
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  const firstBtn = buttons.find((b) => b.classList.contains('btn--primary')) || buttons[0] || closeBtn;
  firstBtn.focus();

  return { close };
}

// ===== MODAL KONFIRMASI =====
export function showConfirm({ title, text, confirmLabel = 'Ya, lanjutkan', kind = 'primary', onConfirm }) {
  return showModal({
    title,
    text,
    actions: [
      { label: 'Batal', kind: 'secondary' },
      { label: confirmLabel, kind, onClick: onConfirm },
    ],
  });
}

// ===== ONBOARDING (3 LANGKAH) =====
const ONBOARDING_STEPS = [
  {
    title: 'Ambil kunci API',
    text: 'Buka aistudio.google.com, buat kunci API Gemini, lalu tempel di Pengaturan (tombol gear di kanan atas). Kunci hanya tersimpan di browser ini. Periksa syarat penggunaan Google AI Studio (termasuk batas usia dan penggunaan data pada paket gratis); jika kamu di bawah 18 tahun, minta guru atau orang tua menyiapkan kunci.',
  },
  {
    title: 'Isi materi belajarmu',
    text: 'Di Pengaturan (tombol gear di kanan atas), lampirkan file .txt / .md / .pdf / .docx ke panel Materi — tarik ke kotak unggah atau klik. Tutor diarahkan menjawab dari materi ini dan menandai kutipan yang tidak ditemukan di materi, tetapi tetap periksa kembali jawabannya.',
  },
  {
    title: 'Siap mulai?',
    text: 'Pilih mode belajar dan atur kedalaman bimbingan, lalu mulai sesi. Selamat belajar!',
  },
];

export function showOnboarding({ onComplete, onSkip }) {
  const root = document.getElementById('modalRoot');
  let step = 0;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const progress = document.createElement('div');
  progress.className = 'onboarding__progress';
  const body = document.createElement('div');
  body.className = 'onboarding__steps';
  const bar = document.createElement('div');
  bar.className = 'modal__actions';
  modal.append(progress, body, bar);
  overlay.appendChild(modal);
  root.appendChild(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (onSkip) onSkip();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  function render() {
    const s = ONBOARDING_STEPS[step];
    progress.innerHTML = ONBOARDING_STEPS.map(
      (_, i) => `<span class="onboarding__dot${i === step ? ' is-active' : ''}"></span>`
    ).join('');
    body.innerHTML = `
      <div class="modal__header" style="margin-bottom:0">
        <h2 class="modal__title">${s.title}</h2>
      </div>
      <p class="modal__text" style="margin-top:12px">${s.text}</p>
    `;
    bar.innerHTML = '';

    const skip = document.createElement('button');
    skip.className = 'btn btn--ghost';
    skip.textContent = 'Lewati';
    skip.addEventListener('click', close);
    bar.appendChild(skip);

    if (step > 0) {
      const back = document.createElement('button');
      back.className = 'btn btn--secondary';
      back.textContent = 'Kembali';
      back.addEventListener('click', () => {
        step -= 1;
        render();
      });
      bar.appendChild(back);
    }

    const next = document.createElement('button');
    next.className = 'btn btn--primary';
    next.textContent = step === ONBOARDING_STEPS.length - 1 ? 'Mulai Belajar' : 'Lanjut';
    next.addEventListener('click', () => {
      if (step === ONBOARDING_STEPS.length - 1) {
        close();
        if (onComplete) onComplete();
      } else {
        step += 1;
        render();
      }
    });
    bar.appendChild(next);
    next.focus();
  }

  render();
  return { close };
}

// ===== TIMER SESI =====
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ===== TANGGAL RELATIF (riwayat sesi, bahasa Indonesia) =====
export function formatRelativeDate(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = now - ts;
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < 2 * MIN) return 'Baru saja';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} mnt lalu`;
  const d = new Date(ts);
  if (d.toDateString() === new Date(now).toDateString()) return 'Hari ini';
  if (d.toDateString() === new Date(now - DAY).toDateString()) return 'Kemarin';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

// Jalankan timer mm:ss yang ditulis ke `element`.
// `getStartedAt()` mengembalikan timestamp mulai (atau null).
export function startSessionTimer({ element, getStartedAt }) {
  let timerId = null;
  function tick() {
    const startedAt = getStartedAt();
    if (!startedAt) {
      element.textContent = '00:00';
      return;
    }
    element.textContent = formatDuration(Date.now() - startedAt);
  }
  tick();
  timerId = setInterval(tick, 1000);
  return {
    stop() {
      if (timerId) clearInterval(timerId);
      timerId = null;
    },
  };
}

// ===== PENGHITUNG DIALOG =====
export function setDialogCount(element, count) {
  if (element) element.textContent = String(count);
}

// ===== EKSPOR PERCAKAPAN (.md) =====
export function exportConversation({ meta, messages }) {
  const date = new Date().toLocaleString('id-ID', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const materiSnippet = (meta.materi || '')
    .trim()
    .slice(0, 400)
    .replace(/\n+/g, ' ')
    .trim();

  const lines = [];
  lines.push('# Percakapan TanyaBukan', '');
  lines.push(`- **Tanggal:** ${date}`);
  lines.push(`- **Mode:** ${getModeLabel(meta.mode)}`);
  lines.push(`- **Kedalaman:** ${meta.level} — ${getLevelLabel(meta.level)}`);
  lines.push(`- **Durasi aktif:** ${meta.duration}`);
  lines.push(`- **Jumlah giliran:** ${meta.turns}`);
  lines.push(`- **Jumlah petunjuk:** ${meta.hints ?? 0}`);
  if (meta.model) lines.push(`- **Model:** ${meta.model}`);
  if (meta.webSearch !== undefined) lines.push(`- **Cari web:** ${meta.webSearch ? 'aktif' : 'nonaktif'}`);
  lines.push('');

  lines.push('## Materi (ringkas)', '');
  lines.push(materiSnippet ? `> ${materiSnippet}` : '> (belum ada materi)');
  lines.push('', '## Percakapan', '');

  messages.forEach((m) => {
    if (m.hidden) return;
    const who = m.role === 'user' ? 'Kamu' : m.role === 'model' ? 'Tutor' : 'Catatan';
    if (typeof m.text !== 'string') return;
    lines.push(`**${who}:**`, '', m.label || m.text, '');
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  download(`tanyabukan-pembelajaran-${stamp}.md`, lines.join('\n'));
  showToast('Percakapan berhasil diunduh.', 'success');
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===== HAPUS SEMUA DATA =====
export function clearAllData() {
  storage.clearAll();
}
