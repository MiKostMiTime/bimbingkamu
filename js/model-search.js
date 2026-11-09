// =========================================================
// BimbingKamu — MODEL SEARCH
// Filter pencarian manual untuk dropdown model (<select>).
//
// Dropdown model bisa berisi ratusan id (Electron Hub ~599), sehingga
// <select> native sulit dijelajahi (tampil satu per satu, harus discroll
// panjang). Modul ini menyisipkan input filter + tombol clear di ATAS
// select, lalu menyembunyikan/menampilkan <option> berdasarkan substring
// (case-insensitive) tanpa mengubah styling select yang sudah ada.
//
// Reusable: dipakai di panel pengaturan (app.js) dan modal onboarding
// (ui.js). Dipanggil berkali-kali tetap aman (idempotent) lewat cache di
// element, dan bisa direset dari luar saat daftar model rebuild.
// =========================================================

const CACHE = '__modelSearchApi';

export function attachModelSearch(selectEl, opts = {}) {
  // Hindari pengkabelan ganda jika dipanggil lebih dari satu kali.
  if (selectEl[CACHE]) return selectEl[CACHE];

  const placeholder = opts.placeholder ?? 'Cari model…';
  const debounceMs = opts.debounceMs ?? 100;

  // Label sibling (.field__label) dipakai untuk menampilkan jumlah hasil.
  // .field__label sudah justify-content: space-between, jadi badge otomatis
  // melekat ke tepi kanan tanpa perlu ubah struktur HTML.
  const scope = selectEl.closest('.field') || selectEl.parentElement;
  const label = scope ? scope.querySelector('.field__label') : null;

  // --- Bangun wrapper: input + tombol clear ---
  const wrap = document.createElement('div');
  wrap.className = 'model-search';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'model-search__input input';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.autocomplete = 'off';
  input.spellcheck = false;

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'model-search__clear';
  clear.setAttribute('aria-label', 'Hapus pencarian');
  clear.title = 'Hapus pencarian';
  clear.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  wrap.appendChild(input);
  wrap.appendChild(clear);
  selectEl.parentNode.insertBefore(wrap, selectEl);

  const options = () => Array.from(selectEl.options);
  const total = () => options().length;
  const visibleCount = () => options().filter((o) => !o.hidden).length;

  // --- Badge jumlah di samping label field ---
  let badge = null;
  if (label) {
    badge = document.createElement('span');
    badge.className = 'model-search__count';
    badge.setAttribute('aria-hidden', 'true');
    label.appendChild(badge);
  }

  function renderCount(active) {
    if (!badge) return;
    // Tanpa pencarian: tampilkan total. Saat aktif: x / total.
    badge.textContent = active ? `${visibleCount()} / ${total()}` : String(total());
  }

  // --- Filter substring (case-insensitive) ---
  function apply(query) {
    const q = String(query ?? '').trim().toLowerCase();
    let firstVisible = null;
    for (const opt of options()) {
      const match = !q || opt.value.toLowerCase().includes(q);
      opt.hidden = !match; // sembunyikan yang tidak cocok
      if (match && firstVisible === null) firstVisible = opt;
    }
    // Jika pilihan sekarang terungkip, pindah ke hasil pertama agar dropdown
    // tidak kosong. Ini memicu event 'change' → setting model tersimpan.
    const cur = selectEl.options[selectEl.selectedIndex];
    if (firstVisible && cur && cur.hidden) {
      selectEl.value = firstVisible.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    clear.style.display = q ? '' : 'none';
    renderCount(q.length > 0);
  }

  // --- Debounce agar tidak filter tiap ketukan ---
  let timer = null;
  function onInput() {
    clearTimeout(timer);
    const q = input.value;
    timer = setTimeout(() => apply(q), debounceMs);
  }
  input.addEventListener('input', onInput);

  // Reset ke semua opsi (panggil saat provider/model berubah → daftar rebuild).
  function reset() {
    input.value = '';
    clearTimeout(timer);
    apply('');
  }

  // --- Tombol clear ---
  clear.addEventListener('click', () => reset());

  // Simpan API di element agar idempotent + bisa direset dari luar.
  const api = { input, reset, apply: (q) => apply(q ?? '') };
  selectEl[CACHE] = api;

  renderCount(false);
  return api;
}
