// js/pricing.js
// Harga model & kurs TIDAK di-hardcode:
// - Harga model bersumber dari endpoint (mis. OpenRouter /api/v1/models)
//   atau input manual user di Pengaturan (per 1M token, USD).
// - Kurs USD→IDR diambil dari API kurs publik (cache 24 jam di localStorage);
//   user bisa override di Pengaturan.
// Semua fungsi murni menerima angka — tanpa tabel harga bawaan.

// ===== KURS USD→IDR (DINAMIS) =====
const RATE_CACHE_KEY = 'tanyabukan.usdIdr';
const RATE_TTL = 24 * 60 * 60 * 1000; // 24 jam

// Ambil kurs dari cache + umurnya (ms). Return { rate, ageMs } atau null.
export function cachedUsdIdr(now = Date.now()) {
  try {
    const raw = JSON.parse(localStorage.getItem(RATE_CACHE_KEY) || 'null');
    if (raw && typeof raw.rate === 'number' && raw.rate > 0 && typeof raw.at === 'number') {
      return { rate: raw.rate, ageMs: Math.max(0, now - raw.at), stale: now - raw.at >= RATE_TTL };
    }
  } catch {}
  return null;
}

// Simpan kurs hasil fetch ke cache.
export function cacheUsdIdr(rate, now = Date.now()) {
  try { localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ rate, at: now })); } catch {}
}

// Fetch kurs live dari API publik tanpa kunci (open.er-api.com).
// Gagal / offline → null (pemanggil pakai cache atau default manual user).
export async function fetchUsdIdr() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data && data.rates && Number(data.rates.IDR);
    if (Number.isFinite(rate) && rate > 0) {
      cacheUsdIdr(rate);
      return rate;
    }
  } catch {}
  return null;
}

// Kurs efektif: override manual user → cache (termasuk cache basi sebagai
// fallback terakhir) → null (tak bisa hitung).
export function effectiveUsdIdr(manualRate) {
  const m = Number(manualRate);
  if (Number.isFinite(m) && m > 0) return m;
  const c = cachedUsdIdr();
  return c ? c.rate : null;
}

// ===== ESTIMASI BIAYA =====
// price = { input, output } per 1M token USD (dari endpoint / input user).
// null price → biaya tak diketahui.
export function estimateCost(price, tokens = {}) {
  if (!price || typeof price.input !== 'number' || typeof price.output !== 'number') return null;
  const usd = ((tokens.prompt ?? 0) * price.input + (tokens.completion ?? 0) * price.output) / 1e6;
  return +usd.toFixed(6);
}

// ===== FORMAT =====
export function formatCostIDR(usd, rate) {
  if (typeof usd !== 'number' || typeof rate !== 'number') return null;
  const idr = Math.round(usd * rate);
  return `Rp${idr.toLocaleString('id-ID')}`;
}

// Format USD internal (ekspor data).
export function formatCost(usd) {
  return `$${Number(usd).toFixed(2)}`;
}
