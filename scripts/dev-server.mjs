// =========================================================
// BimbingKamu — DEV SERVER LOKAL
// Menyajikan file statis + menjalankan functions/api/* (Pages Functions)
// supaya /api/search, /api/fetch, dan /api/proxy benar-benar hidup saat
// pengembangan. Tanpa ini, server statis biasa (python http.server / serve)
// membuat pencarian web & lampiran URL selalu gagal.
//
// Pakai:  npm run dev
//         TAVILY_API_KEY=tvly-... npm run dev
// =========================================================
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import * as search from '../functions/api/search.js';
import * as pageFetch from '../functions/api/fetch.js';
import * as proxy from '../functions/api/proxy.js';

// Statis disajikan dari public/ (output Pages), Functions dari root/functions.
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = resolve(ROOT, 'public');
const PORT = Number(process.env.PORT || 5500);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

const ROUTES = {
  '/api/search': { GET: search.onRequestGet, POST: search.onRequestPost },
  '/api/fetch': { GET: pageFetch.onRequestGet },
  '/api/proxy': {
    GET: proxy.onRequestGet,
    POST: proxy.onRequestPost,
    PUT: proxy.onRequestPut,
    PATCH: proxy.onRequestPatch,
    DELETE: proxy.onRequestDelete,
    OPTIONS: proxy.onRequestOptions,
  },
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function fileForPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const rel = normalize(decoded).replace(/^[/\\]+/, '');
  const file = resolve(PUBLIC, rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) return null;
  return file;
}

async function serveStatic(req, res, pathname) {
  let file = fileForPath(pathname === '/' ? '/index.html' : pathname);
  if (!file) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad path');
    return;
  }

  let info = await stat(file).catch(() => null);
  if (info && info.isDirectory()) {
    file = resolve(file, 'index.html');
    info = await stat(file).catch(() => null);
  }

  if (!info || !info.isFile()) {
    // Navigasi SPA (mis. /chat) → index.html; aset yang hilang → 404 jujur.
    const wantsHtml = String(req.headers.accept || '').includes('text/html');
    if (!wantsHtml) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    file = resolve(PUBLIC, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('public/index.html tidak ditemukan');
      return;
    }
  }

  const data = await readFile(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
  const route = ROUTES[url.pathname];

  if (route) {
    const method = (req.method || 'GET').toUpperCase();
    const handler = route[method];
    if (!handler) {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
      return;
    }
    try {
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
      const request = new Request(url.href, { method, headers: req.headers, body });
      const response = await handler({ request, env: process.env });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end(await response.text());
    } catch (err) {
      console.error('[dev]', url.pathname, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'dev-server-error' }));
      } else {
        res.end();
      }
    }
    return;
  }

  await serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  const key = process.env.TAVILY_API_KEY ? 'aktif (server)' : 'belum diset — pakai kolom Kunci Tavily di Pengaturan';
  console.log(`BimbingKamu dev server → http://localhost:${PORT}`);
  console.log(`Pencarian web: ${key}`);
});