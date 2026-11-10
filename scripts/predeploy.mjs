// =========================================================
// BimbingKamu — PREDEPLOY (hook staleness bundle)
// Vercel men-deploy js/app.bundle.js yang DI-COMMIT (bukan source).
// Bila developer ubah source (js/*.js, css/*) tapi lupa rebuild+commit,
// bundle tua tayang tanpa error. Hook ini mendeteksi & mencegah itu:
//
//   npm run predeploy     -> build ulang + verifikasi freshness
//   node scripts/predeploy.mjs --check  -> cek saja (tanpa build)
//
// Logika: bundle STALE bila ada source yang mtime-nya BARU dari output
// build (max(mtime source) > min(mtime output)). Exit 1 bila stale agar
// deploy berhenti sebelum mengirim kode tua.
// =========================================================
import { build, transform } from 'esbuild';
import {
  existsSync, readdirSync, statSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCES_RELS = ['js', 'css'];
const OUTPUTS_RELS = ['js/app.bundle.js', 'css/styles.min.css'];

// --- murni: statistik mtime (uji tanpa filesystem) ---
export function maxMtime(entries) {
  return entries.reduce((m, e) => Math.max(m, e.mtimeMs), 0);
}
export function minMtime(entries) {
  return entries.reduce((m, e) => Math.min(m, e.mtimeMs), Number.POSITIVE_INFINITY);
}

// bundle STALE bila ada source lebih baru dari output build terlama.
export function isBundleStale(sources, outputs) {
  if (!outputs.length) return true; // tak ada output -> pasti belum di-build
  return maxMtime(sources) > minMtime(outputs);
}

// --- kumpulkan path source + output berdasarkan root repo ---
export function collectSources(root) {
  // Output build (app.bundle.js, styles.min.css) TIDAK ikut sebagai source.
  const excluded = new Set(OUTPUTS_RELS.map((p) => path.basename(p)));
  const files = [];
  for (const rel of SOURCES_RELS) {
    const dir = path.join(root, rel);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if ((f.endsWith('.js') || f.endsWith('.css')) && !excluded.has(f)) {
        files.push(path.join(dir, f));
      }
    }
  }
  return files;
}

export function gatherEntries(root = ROOT) {
  const sources = collectSources(root).map((p) => ({ path: p, mtimeMs: statSync(p).mtimeMs }));
  const outputs = OUTPUTS_RELS
    .filter((p) => existsSync(path.join(root, p)))
    .map((p) => ({ path: path.join(root, p), mtimeMs: statSync(path.join(root, p)).mtimeMs }));
  return { sources, outputs };
}

// --- jalankan build esbuild (mirui scripts/build.mjs) -> segarkan output ---
export async function runBuild(root = ROOT) {
  const entry = path.join(root, 'js/app.js');
  if (!existsSync(entry)) throw new Error(`entry point tidak ditemukan: ${entry}`);

  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2019'],
    minify: true,
    outfile: path.join(root, 'js/app.bundle.js'),
    logLevel: 'info',
    legalComments: 'none',
  });

  const cssOrder = ['css/variables.css', 'css/main.css', 'css/components.css'];
  let css = '';
  for (const f of cssOrder) {
    const p = path.join(root, f);
    if (existsSync(p)) css += readFileSync(p, 'utf8') + '\n\n';
  }
  const out = await transform(css, { loader: 'css', minify: true });
  writeFileSync(path.join(root, 'css/styles.min.css'), out.code);
}

function fmt(ms) { return new Date(ms).toLocaleString(); }

async function main(argv) {
  const checkOnly = argv.includes('--check');
  const { sources, outputs } = gatherEntries(ROOT);
  const staleBefore = isBundleStale(sources, outputs);

  if (staleBefore) {
    console.log('[predeploy] PERINGATAN: bundle STALE vs source (source lebih baru dari output build).');
  } else {
    console.log('[predeploy] bundle searah dengan source.');
  }

  if (!checkOnly) {
    console.log('[predeploy] rebuild bundle + css...');
    await runBuild(ROOT);
  }

  // Verifikasi ulang SETELAH build: output harus >= semua source.
  const after = gatherEntries(ROOT);
  if (isBundleStale(after.sources, after.outputs)) {
    console.error('[predeploy] GAGAL: output build tetap lebih lama dari source.');
    console.error(`[predeploy] max source : ${fmt(maxMtime(after.sources))}`);
    console.error(`[predeploy] min output : ${fmt(minMtime(after.outputs))}`);
    process.exit(1);
  }

  if (checkOnly) {
    console.log('[predeploy] OK: bundle fresh (mode cek, tanpa rebuild).');
  } else {
    console.log('[predeploy] OK: bundle + css segar -> siap deploy.');
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('predeploy.mjs')) {
  main(process.argv.slice(2)).catch((e) => {
    console.error('[predeploy]', e && e.message ? e.message : e);
    process.exit(1);
  });
}
