// js/pricing.js
// Tabel harga indikatif per 1M token (USD). Fokus: token keluar (completion).
export const PRICES = {
  'gemini-3.8-flash': { input: 0.5, output: 4 },
  'gemini-3.6-flash': { input: 0.3, output: 2.5 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'deepseek-v3': { input: 0.27, output: 1.1 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  // wildcard prefix (diakhiri *):
  'qwen-*': { input: 0, output: 0 },
  'groq-*': { input: 0, output: 0 },
};

export function findPrice(modelId) {
  if (!modelId) return null;
  // match eksak duluan, baru wildcard prefix (mis. qwen-max → qwen-*)
  if (PRICES[modelId]) return PRICES[modelId];
  for (const key of Object.keys(PRICES)) {
    if (key.endsWith('*') && modelId.startsWith(key.slice(0, -1))) return PRICES[key];
  }
  return null;
}

export function estimateCost(modelId, tokens = {}) {
  const price = findPrice(modelId);
  if (!price) return null;
  const completion = tokens.completion ?? 0;
  return +(completion * price.output / 1e6).toFixed(6);
}

export function formatCost(usd) {
  return `$${Number(usd).toFixed(2)}`;
}
