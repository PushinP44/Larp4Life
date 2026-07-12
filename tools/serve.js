/**
 * tools/serve.js — zero-dependency static dev server for Ecosystem X.
 *
 * The game is a single static bundle of ES modules, so it must be served over
 * HTTP (opening index.html via file:// blocks module imports and fetch()).
 *
 *   npm run serve            # http://localhost:8080
 *   npm run serve -- 3000    # custom port
 *
 * It applies the SAME security response headers documented in
 * security/deploy-headers.md (minus HSTS, which is only meaningful over HTTPS),
 * so local dev matches the EdgeOne production origin. Cross-platform, Node ≥18,
 * no npm install required.
 */

import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, '..');
const PORT        = Number(process.argv[2]) || Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// Mirrors security/deploy-headers.md — the security AI-module story, live in dev.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    // Decode + strip query, default to index.html
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    // Resolve inside ROOT only (path-traversal guard — PENTEST hygiene)
    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) return send(res, 404, `Not found: ${urlPath}`);

    const ext  = path.extname(filePath).toLowerCase();
    const data = await readFile(filePath);
    send(res, 200, data, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Dev server: never cache. `no-cache` alone still let some browsers serve
      // stale ES modules (no ETag/Last-Modified here to revalidate against), so a
      // source edit wouldn't show on reload. `no-store` guarantees fresh modules.
      'Cache-Control': 'no-store, max-age=0',
    });
  } catch (err) {
    send(res, 500, `Server error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Ecosystem X — dev server running`);
  console.log(`  ▶  http://localhost:${PORT}`);
  console.log(`  (Ctrl+C to stop · security headers applied to match production)\n`);
});
