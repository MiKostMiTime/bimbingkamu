// =========================================================
// BimbingKamu — BUILD (esbuild)
// Menggabungkan + meminify semua JS app menjadi SATU bundle,
// dan meminify CSS menjadi satu file. Tujuannya: mengurangi
// jumlah request + biaya parse/compile di perangkat rendah.
//
// Cara pakai:  npm run build
// Output:      public/js/app.bundle.js  (semua modul app → 1 file)
//              public/css/styles.min.css
// Catatan:     hasil BUILD harus DI-COMMIT agar deploy statis
//              (Cloudflare Pages) tetap jalan tanpa langkah CI.
// =========================================================
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const log = (msg) => console.log(`[build] ${msg}`);

// ---- P0: bundle + minify semua JS app -> 1 file ----
// target es2019: didukung browser perangkat rendah (Chrome ~80+/Android).
// vendor (marked, DOMPurify) dimuat via <script src> di index.html dan
// diakses lewat global window, jadi TIDAK ikut di-bundle (tetap terpisah).
// path dinamis './vendor/...' & '../vendor/...' adalah string literal yang
// di-resolve saat runtime dari document.baseURI -> tetap benar setelah bundle.
log('membundle JS app...');
await build({
  entryPoints: ['public/js/app.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2019'],
  minify: true,
  outfile: 'public/js/app.bundle.js',
  logLevel: 'info',
  legalComments: 'none',
});

// ---- P1: minify CSS -> 1 file (urutkan: variables > main > components) ----
log('meminify CSS...');
const cssOrder = ['public/css/variables.css', 'public/css/main.css', 'public/css/components.css'];
let css = cssOrder.map((f) => readFileSync(f, 'utf8')).join('\n\n');
const out = await transform(css, { loader: 'css', minify: true });
writeFileSync('public/css/styles.min.css', out.code);

log('selesai -> public/js/app.bundle.js + public/css/styles.min.css');
