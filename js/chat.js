// =========================================================
// BimbingKamu — CHAT
// Render pesan, efek typing progresif, markdown, citation,
// dan rumus (KaTeX, lihat math.js).
// =========================================================

import { extractMath, loadKatex } from './math.js';
import { formatCost } from './pricing.js';
import { isValidHttpUrl, truncateSnippet } from './api.js';

// ===== UTIL TEKS =====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== RENDER MARKDOWN (aman) =====
// marked + DOMPurify dimuat lokal (./vendor) di index.html. Jika muat
// gagal (offline), turunkan ke teks polos yang di-escape.
export function renderMarkdown(text) {
  const markedLib = window.marked;
  const purify = window.DOMPurify;

  if (!markedLib || !purify) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  const raw = markedLib.parse(text, { breaks: true, gfm: true });
  const clean = purify.sanitize(raw);
  return renderCitations(clean);
}

// ===== CITATION [[...]] → <mark> =====
// Ubah pasangan [[teks]] menjadi chip highlight + tooltip.
// Hanya pasangan lengkap yang diubah; yang belum lengkap
// (saat sedang diketik) tetap teks biasa.
// Frasa yang TIDAK ditemukan di materi ditandai "belum terverifikasi"
// supaya klaim "berdasarkan materi" bisa diuji, bukan sekadar janji prompt.
let materiProvider = () => '';
export function setMateriProvider(fn) {
  materiProvider = typeof fn === 'function' ? fn : () => '';
}

const normText = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
let memoSrc = null;
let memoNorm = '';
function normalizedMateri() {
  const src = materiProvider() || '';
  if (src !== memoSrc) {
    memoSrc = src;
    memoNorm = normText(src); // di-cache: renderRich dipanggil berulang saat mengetik
  }
  return memoNorm;
}

function renderCitations(html) {
  const hay = normalizedMateri();
  return html.replace(/\[\[([^\[\]]+)\]\]/g, (match, inner) => {
    const safe = escapeHtml(inner.trim());
    const ok = !hay || hay.includes(normText(inner));
    const note = ok ? '' : ' (belum terverifikasi di materi)';
    return (
      `<mark class="citation${ok ? '' : ' citation--unverified'}" tabindex="0" role="note" aria-label="Rujukan materi: ${safe}${note}">` +
      `${safe}<span class="citation__tip" aria-hidden="true">“${safe}”${note}</span>` +
      `</mark>`
    );
  });
}

// ===== MATH (KaTeX) =====
// Token @@TB_MATH_n@@ dari extractMath lolos marked + DOMPurify
// sebagai teks biasa; di sini diganti node rumus. KaTeX termuat
// on-demand (math.js); jika belum termuat — atau offline — rumus
// tampil sebagai teks mentah (math--raw) lalu ditingkatkan
// otomatis ke KaTeX begitu library tiba.
let katexRef = null;

function mathToNode(tex, display) {
  const el = document.createElement('span');
  el.setAttribute('data-tex', tex);
  el.className = 'math';
  if (display) el.classList.add('math--display');
  if (katexRef) {
    try {
      // throwOnError: true → kami yang mengendalikan fallback (blok raw rapi),
      // bukan KaTeX menyisakan teks mentah di tengah paragraf bila rumus rusak.
      katexRef.render(tex, el, { displayMode: display, throwOnError: true });
    } catch (err) {
      el.classList.add('math--error');
      el.textContent = display ? `\\[${tex}\\]` : `$${tex}$`;
    }
  } else {
    el.classList.add('math--raw');
    el.textContent = display ? `\\[${tex}\\]` : `$${tex}$`;
  }
  return el;
}

// Ganti token math yang tersisa di text nodes sebuah container.
function hydrateMath(container, math) {
  if (!container || !math.length) return;
  if (typeof document === 'undefined' || !document.createTreeWalker) return;
  const TOKEN_RE = /@@TB_MATH_(\d+)@@/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    const matches = [...node.nodeValue.matchAll(TOKEN_RE)];
    if (!matches.length) return;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const m of matches) {
      if (m.index > cursor) {
        frag.appendChild(document.createTextNode(node.nodeValue.slice(cursor, m.index)));
      }
      const entry = math[Number(m[1])];
      frag.appendChild(
        entry ? mathToNode(entry.tex, entry.display) : document.createTextNode(m[0])
      );
      cursor = m.index + m[0].length;
    }
    if (cursor < node.nodeValue.length) {
      frag.appendChild(document.createTextNode(node.nodeValue.slice(cursor)));
    }
    node.replaceWith(frag);
  });

  // Rumus sempat ter-render raw (KaTeX belum termuat) → upgrade
  // in-place begitu KaTeX tiba, tanpa render ulang penuh.
  if (!katexRef) {
    loadKatex()
      .then((k) => {
        katexRef = k;
        container.querySelectorAll('.math--raw').forEach((old) => {
          old.replaceWith(
            mathToNode(old.getAttribute('data-tex') || '', old.classList.contains('math--display'))
          );
        });
      })
      .catch(() => {
        // Offline: rumus tetap terbaca sebagai teks mentah.
      });
  }
}

// ===== RENDER KAYA (markdown + math) ke sebuah elemen =====
export function renderRich(el, text, { skipMath = false } = {}) {
  const { text: safe, math } = extractMath(text);
  el.innerHTML = renderMarkdown(safe);
  if (!skipMath) hydrateMath(el, math); // streaming live: tunda hydrate KaTeX agar ringan
}

// ===== AVATAR =====
function avatar(label) {
  const el = document.createElement('div');
  el.className = 'msg__avatar';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = label;
  return el;
}

// ===== BUBBLE BANTUAN =====
function makeColumn(metaText) {
  const col = document.createElement('div');
  col.className = 'msg__col';

  if (metaText) {
    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    meta.textContent = metaText;
    col.appendChild(meta);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';
  const content = document.createElement('div');
  content.className = 'msg__content';
  bubble.appendChild(content);
  col.appendChild(bubble);
  return { col, content };
}

// ===== PESAN USER =====
export function addUserMessage(root, text) {
  removeEmptyState(root);
  const msg = document.createElement('div');
  msg.className = 'msg msg--user';
  msg.appendChild(avatar('K'));
  const { col, content } = makeColumn('Kamu');
  content.textContent = text; // teks polos, aman
  msg.appendChild(col);
  root.appendChild(msg);
  return msg;
}

// Ikon pensil untuk "Sunting" (edit).
export const EDIT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// Ikon salin & hapus untuk bar aksi pesan.
export const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
export const DELETE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M6 7v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7"/><path d="M9 7V4h6v3"/><path d="M9 11v6M15 11v6"/></svg>';

// Bar aksi hover (icon-only) untuk bubble pesan. `items`: [{ icon, label, onClick, disabled?, stopClose? }].
// Dipakai ulang tiap rebuild (re-render) sehingga aksi selalu sinkron dengan state.
// Ketok tombol menutup bar (toggle di .msg) kecuali stopClose = false (mis. editor).
export function addActionbar(col, { items = [], role = 'model' } = {}) {
  let bar = col.querySelector('.msg__actions');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'msg__actions';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', role === 'user' ? 'Aksi pertanyaan' : 'Aksi balasan tutor');
    col.appendChild(bar);
  }
  bar.innerHTML = '';
  for (const it of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg__action btn btn--ghost btn--icon btn--sm';
    btn.setAttribute('aria-label', it.label);
    if (it.tooltip) btn.title = it.tooltip;
    if (it.disabled) btn.disabled = true;
    btn.innerHTML = it.icon;
    if (typeof it.onClick === 'function') {
      btn.addEventListener('click', (e) => {
        if (it.stopClose !== false && e && e.stopPropagation) e.stopPropagation();
        it.onClick();
      });
    }
    bar.appendChild(btn);
  }
  return bar;
}

// Bubble user dengan bar aksi: ikon "Sunting" (+ "Hapus" bila onEdit/onDelete ada).
// Klik Sunting → ganti teks dengan textarea inline + bar Simpan/Batal. Saat Simpan,
// panggil onEdit(newText). editIdx ditangkap caller (app.js) lewat closure; chat.js
// hanya perlu membarui tampilan teks bubble.
export function addUserMessageWithEdit(root, text, { onEdit, onDelete } = {}) {
  removeEmptyState(root);
  const msg = document.createElement('div');
  msg.className = 'msg msg--user';
  msg.appendChild(avatar('K'));
  const { col, content } = makeColumn('Kamu');
  content.textContent = text;
  content.dataset.original = text;

  if (typeof onEdit === 'function' || typeof onDelete === 'function') {
    function buildPill() {
      const items = [];
      if (typeof onEdit === 'function') {
        items.push({ icon: EDIT_ICON, label: 'Sunting pertanyaan', onClick: openEditor });
      }
      if (typeof onDelete === 'function') {
        items.push({ icon: DELETE_ICON, label: 'Hapus pertanyaan', onClick: onDelete });
      }
      return addActionbar(col, { items, role: 'user' });
    }

    function openEditor() {
      msg.classList.add('is-actions-open'); // pastikan bar tampil di mobile (tanpa hover)
      content.textContent = '';
      const ta = document.createElement('textarea');
      ta.className = 'msg__edit';
      ta.value = content.dataset.original;
      content.appendChild(ta);
      ta.focus();
      ta.select();
      // Ganti bar ikon dengan bar editor (Sunting & regenerasi / Batal).
      const bar = col.querySelector('.msg__actions');
      bar.innerHTML = '';
      const simpan = document.createElement('button');
      simpan.type = 'button';
      simpan.className = 'btn btn--primary btn--sm';
      simpan.textContent = 'Sunting & regenerasi';
      const batal = document.createElement('button');
      batal.type = 'button';
      batal.className = 'btn btn--ghost btn--sm';
      batal.textContent = 'Batal';
      const closeEditor = () => {
        content.textContent = content.dataset.original;
        msg.classList.remove('is-actions-open'); // kembalikan visibilitas ikuti hover
        if (bar.parentElement) buildPill(); // kembalikan bar ikon
      };
      simpan.addEventListener('click', async () => {
        const newText = ta.value.trim();
        if (!newText) return;
        content.dataset.original = newText;
        await onEdit(newText); // app.js membarui state.messages + regenerasi ke belakang
        closeEditor(); // Kembalikan bubble ke mode tampilkan setelah regenerasi.
      });
      batal.addEventListener('click', closeEditor);
      bar.appendChild(simpan);
      bar.appendChild(batal);
    }

    buildPill();
  }
  msg.appendChild(col);
  root.appendChild(msg);
  return msg;
}

// ===== PESAN MODEL =====
// Membuat bubble kosong siap diisi; kembalikan { msg, content, col }.
// `col` = .msg__col tempat menempati tombol aksi (mis. regenerasi). Pemanggil
// lama yang hanya butuh { msg, content } tetap berjalan (destruksi sebagian).
export function addModelMessage(root) {
  removeEmptyState(root);
  const msg = document.createElement('div');
  msg.className = 'msg msg--model';
  msg.appendChild(avatar('T'));
  const { col, content } = makeColumn('Tutor');
  msg.appendChild(col);
  root.appendChild(msg);
  return { msg, content, col };
}

// ===== PESAN NOTIFIKASI (sistem/error) =====
export function addNotice(root, text, kind = 'system') {
  const msg = document.createElement('div');
  msg.className = `msg msg--notice msg--${kind}`;
  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';
  bubble.textContent = text;
  msg.appendChild(bubble);
  root.appendChild(msg);
  return msg;
}

// ===== TYPING INDICATOR =====
export function showTyping(root) {
  removeEmptyState(root);
  const msg = document.createElement('div');
  msg.className = 'msg msg--model';
  msg.dataset.typing = 'true';
  msg.appendChild(avatar('T'));

  const col = document.createElement('div');
  col.className = 'msg__col';
  const meta = document.createElement('div');
  meta.className = 'msg__meta';
  meta.textContent = 'Tutor';
  col.appendChild(meta);

  const wrap = document.createElement('div');
  wrap.className = 'msg__bubble';
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.setAttribute('aria-label', 'Tutor sedang menulis');
  for (let i = 0; i < 3; i += 1) typing.appendChild(document.createElement('span'));
  wrap.appendChild(typing);
  col.appendChild(wrap);
  msg.appendChild(col);
  root.appendChild(msg);
  return msg;
}

export function removeTyping(el) {
  if (el && el.parentNode) el.remove();
}

// Sisipkan indikator titik-titik (.typing) ke dalam bubble konten model agar
// progress "sedang menulis" tetap terlihat saat model sedang berpikir,
// yaitu sebelum token pertama muncul. Kembalikan elemen .typing agar bisa dihapus.
// Teks status bertahap untuk indikator typing (logika murni, untuk diuji).
export function typingStatusText(stage) {
  return stage === 'answering' ? 'Sedang menjawab…' : 'Menghubungkan ke AI…';
}

export function insertBubbleTyping(content) {
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.setAttribute('aria-label', 'Tutor sedang menulis');
  const status = document.createElement('span');
  status.className = 'typing__status';
  status.textContent = typingStatusText('connecting');
  const caret = document.createElement('span');
  caret.className = 'typing__caret';
  caret.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) typing.appendChild(document.createElement('span'));
  typing.append(status, caret);
  // Letakkan di ATAS konten (saudara .msg__content) agar tetap tampil saat
  // streaming — renderRich() memimpa innerHTML content, jadi indikator ini
  // TIDAK hilang sendiri; dihapus eksplisit di app.js saat token pertama alir.
  const bubble = content.closest('.msg__bubble');
  if (bubble) bubble.insertBefore(typing, content);
  else content.prepend(typing);
  return { el: typing, status, setCaret: (on) => caret.classList.toggle('is-on', on) };
}

// ===== EFEK TYPING PROGRESIF =====
// Munculkan teks kata-per-kata (adaptif, maks. ±2,5 dtk) dengan render
// markdown berkala. Kembalikan { skip } untuk men-skip.
export function streamText(content, fullText, { skipButton, onDone } = {}) {
  const tokens = fullText.match(/\S+\s*/g) || [fullText];
  // Total animasi dibatasi ±2,5 detik berapa pun panjang balasannya, dan render
  // markdown dijarangkan untuk balasan panjang (hemat CPU, tidak berkedip).
  const delay = Math.max(2, Math.min(20, Math.floor(2500 / tokens.length)));
  const every = Math.max(3, Math.ceil(tokens.length / 60));
  let i = 0;
  let timer = null;
  let finished = false;

  function paint() {
    renderRich(content, tokens.slice(0, i).join(''));
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    renderRich(content, fullText);
    if (skipButton && skipButton.parentNode) skipButton.remove();
    if (onDone) onDone();
  }

  function step() {
    if (finished) return;
    i += 1;
    // Render berkala (setiap 3 kata) supaya ringan; akhir pasti dirender.
    if (i % every === 0 || i >= tokens.length) paint();
    if (i >= tokens.length) {
      finish();
      return;
    }
    timer = setTimeout(step, delay);
  }

  if (skipButton) skipButton.addEventListener('click', finish);

  // Batalkan saat tab tidak terlihat untuk hemat; selesai saat terlihat.
  step();
  return { skip: finish };
}

// ===== SUMBER WEB (GROUNDING) =====
// Tampilkan blok "Sumber" + tombol simpan-ke-materi di bawah bubble.
// Container .msg__sources dipakai bersama showWebSearchStatus agar transisi
// loading → sumber tidak membuat dua blok terpisah.

// Ambil atau buat container .msg__sources di dalam col.
function getSourcesBox(col) {
  let box = col.querySelector('.msg__sources');
  if (!box) {
    box = document.createElement('div');
    box.className = 'msg__sources';
    col.appendChild(box);
  }
  return box;
}

// Pemetai sumber → { href, title, snippet } agar bisa diuji tanpa DOM.
// href hanya bila url http(s); selainnya null (tampil sebagai teks, tak ada
// tautan rusak). Judul & snippet dipangkas + aman disimpan.
export function sourceAnchor(source) {
  const url = source && source.url;
  return {
    href: isValidHttpUrl(url) ? url : null,
    title: source?.title || url || '',
    snippet: truncateSnippet(source?.snippet, 200),
  };
}

export function renderSources(msg, sources, { onSave } = {}) {
  if (!msg || !sources || !sources.length) return null;
  const col = msg.querySelector('.msg__col');
  if (!col) return null;

  // Pakai container yang sama dengan status websearch (jaga transisi rapi).
  const box = getSourcesBox(col);
  box.innerHTML = '';

  const head = document.createElement('p');
  head.className = 'msg__sources-title';
  head.textContent = `Sumber (${sources.length})`;
  box.appendChild(head);

  const list = document.createElement('ul');
  for (const s of sources) {
    const li = document.createElement('li');
    const anchor = sourceAnchor(s);
    // href http(s) → <a>; selainnya → <span> (teks, tak ada tautan rusak).
    const a = document.createElement(anchor.href ? 'a' : 'span');
    if (anchor.href) {
      a.href = anchor.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    a.className = 'msg__sources-link';
    a.textContent = anchor.title; // textContent → aman dari XSS
    li.appendChild(a);
    if (anchor.snippet) {
      const p = document.createElement('p');
      p.className = 'msg__sources-snippet';
      p.textContent = anchor.snippet; // textContent → aman
      li.appendChild(p);
    }
    list.appendChild(li);
  }
  box.appendChild(list);

  if (onSave) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost btn--sm';
    btn.textContent = '＋ Simpan ke materi';
    btn.addEventListener('click', () => {
      onSave(sources);
      btn.textContent = 'Tersimpan ✓';
      btn.disabled = true;
    });
    box.appendChild(btn);
  }

  return box;
}

// Tampilkan status websearch per-jawaban di bubble model: loading (menjawab),
// not-found (ada grounding, tak ada sumber), atau unsupported (grounding tak
// didukung endpoint). Container .msg__sources dipakai bersama renderSources agar
// transisi loading → sumber tetap satu blok.
export function showWebSearchStatus(col, status) {
  if (!col) return null;
  const box = getSourcesBox(col);
  box.innerHTML = '';

  if (status === 'loading') {
    // Indikator loading websearch: satu titik berdenyut — berbeda dari
    // titik-titik .typing di bubble jawaban agar tak terkesan ganda.
    const spin = document.createElement('div');
    spin.className = 'sources-loading';
    spin.setAttribute('aria-label', 'Sedang mencari sumber web');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    spin.appendChild(dot);
    box.appendChild(spin);
    const p = document.createElement('p');
    p.className = 'msg__sources-title';
    p.textContent = 'Mencari sumber web…';
    box.appendChild(p);
    return box;
  }

  const p = document.createElement('p');
  p.className = 'msg__sources-title';
  p.textContent = status === 'unsupported'
    ? 'Sumber web not didukung endpoint ini.'
    : 'Tidak ada sumber web.';
  box.appendChild(p);
  return box;
}

// Label status websearch per-state (logika murni, untuk diuji).
export function webSearchStatusText(state) {
  return {
    loading: 'Mencari sumber web…',
    'not-found': 'Tidak ada sumber web.',
    unsupported: 'Sumber web not didukung endpoint ini.',
  }[state];
}

// Terapkan status websearch FINAL ke bubble model (setelah jawaban / saat render
// ulang sesi, sunting, regenerasi). Sumber → renderSources (pakai container
// loading bila ada); tak ada → not-found/unsupported. onSave opsional agar tombol
// "＋ Simpan ke materi" tetap muncul lewat jalur ini.
export function applyWebSearchState(col, { sources = [], supportsGrounding, onSave } = {}) {
  if (!col) return;
  if (sources && sources.length) {
    // renderSources mengambil col via querySelector('.msg__col'); col diketahui.
    renderSources({ querySelector: () => col }, sources, { onSave });
  } else {
    showWebSearchStatus(col, supportsGrounding ? 'not-found' : 'unsupported');
  }
}

// ===== TOMBOL REGENERASI (REDO) =====
// Tombol aksi di footer bubble model untuk meregenerasi balasan terakhir.
export const REDO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

export function addRedoButton(col, onRedo) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg__action btn btn--ghost btn--sm';
  btn.setAttribute('aria-label', 'Regenerasi balasan tutor');
  btn.innerHTML = REDO_ICON;
  if (typeof onRedo === 'function') btn.addEventListener('click', onRedo);
  col.insertBefore(btn, col.firstChild);
  return btn;
}

// ===== FOOTER TOKEN + BIAYA =====
// Tempel ringkasan token & biaya di bawah bubble model (append ke `col`, jadi
// muncul di BAWAH sumber + tombol regenerasi). Hanya tampil bila ada data:
// "N token · ~$X.XX" (token) dan/atau "~$X.XX" (biaya). Kembalikan node-nya.
export function addCostFooter(col, tokens, cost) {
  const foot = document.createElement('div');
  foot.className = 'msg__footer';
  const parts = [];
  // Format arah: ↑ token masuk (prompt), ↓ token keluar (completion).
  if (tokens && typeof tokens.prompt === 'number' && typeof tokens.completion === 'number') {
    parts.push(`↑ ${tokens.prompt.toLocaleString('id-ID')} · ↓ ${tokens.completion.toLocaleString('id-ID')} token`);
  } else if (tokens && typeof tokens.completion === 'number') {
    parts.push(`↓ ${tokens.completion.toLocaleString('id-ID')} token`);
  }
  if (typeof cost === 'number') parts.push(`~${formatCost(cost)}`);
  if (!parts.length) return null;
  foot.textContent = parts.join(' · ');
  col.appendChild(foot);
  return foot;
}

// ===== KOSONGKAN & EMPTY STATE =====
export function clearMessages(root) {
  root.innerHTML = '';
}

// Ikon kompas sederhana untuk empty state.
const EMPTY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>';

export function renderEmptyState(root, { onStart, onOpenSettings, status } = {}) {
  clearMessages(root);
  const box = document.createElement('div');
  box.className = 'empty-state';
  const item = (done, label) =>
    `<li class="${done ? 'is-done' : ''}"><span class="empty-state__mark" aria-hidden="true">${done ? '✓' : '○'}</span>` +
    `${label}<span class="sr-only">${done ? ' (sudah)' : ' (belum)'}</span></li>`;
  const checklist = status
    ? `<ul class="empty-state__checklist" aria-label="Persiapan">
         ${item(status.keyReady, 'Endpoint & model')}
         ${item(status.materiReady, 'File materi')}
       </ul>`
    : '';
  box.innerHTML = `
    <div class="empty-state__icon" aria-hidden="true">${EMPTY_ICON}</div>
    <h2 class="empty-state__title">Mulai belajar dengan BimbingKamu</h2>
    <p class="empty-state__text">
      Siapkan dua hal di Pengaturan (gear, kanan atas): hubungkan endpoint & pilih model, lalu lampirkan file materi. Setelah itu tanya
      apa saja. Tutor akan menjelaskan materimu, mengecek pemahamanmu, dan
      membimbingmu sampai paham.
    </p>
    ${checklist}
  `;

  const actions = document.createElement('div');
  actions.className = 'empty-state__actions';
  if (onOpenSettings) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--secondary';
    btn.type = 'button';
    btn.textContent = 'Buka Pengaturan';
    btn.addEventListener('click', onOpenSettings);
    actions.appendChild(btn);
  }
  if (onStart) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--primary';
    btn.type = 'button';
    btn.textContent = 'Mulai Belajar';
    btn.addEventListener('click', onStart);
    actions.appendChild(btn);
  }
  if (actions.children.length) box.appendChild(actions);

  root.appendChild(box);
  return box;
}

export function removeEmptyState(root) {
  const existing = root.querySelector('.empty-state');
  if (existing) existing.remove();
}

// ===== AUTO-SCROLL =====
// Hanya menggulir ke bawah bila siswa sudah dekat dasar (atau force=true),
// supaya ia bisa membaca bagian atas tanpa ditarik paksa ke bawah.
export function scrollToEnd(scrollEl, force = false) {
  if (!scrollEl) return;
  const gap = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
  if (force || gap < 80) scrollEl.scrollTop = scrollEl.scrollHeight;
}
