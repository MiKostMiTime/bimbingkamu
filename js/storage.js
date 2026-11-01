// =========================================================
// TanyaBukan — STORAGE
// Wrapper localStorage yang aman (selalu try/catch) supaya
// aplikasi tidak pecah saat penyimpanan penuh / nonaktif.
// =========================================================
import { STORAGE_KEYS } from './config.js';

// ===== BACA =====
// Ambil dan parse JSON. Kembalikan `fallback` jika tidak ada
// atau rusak.
function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ===== TULIS =====
// Simpan sebagai JSON. Mengembalikan true/false untuk hasil.
function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ===== HAPUS SATU =====
function remove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// ===== HAPUS SEMUA MILIK TANYABUKAN =====
// Hanya kunci berprefiks aplikasi ini — data aplikasi lain aman.
function clearAll() {
  try {
    const targets = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEYS.prefix)) {
        targets.push(key);
      }
    }
    targets.forEach((key) => localStorage.removeItem(key));
    return true;
  } catch {
    return false;
  }
}

// ===== API PUBLIK =====
export const storage = {
  get,
  set,
  remove,
  clearAll,
};
