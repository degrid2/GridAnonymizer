#!/usr/bin/env node
/**
 * server.mjs - zero-dependency static server for the hosted page (Railway,
 * Fly, Render, a VM, Docker). It sets the security headers itself, because
 * container hosts ignore `_headers`; the CSP is what makes "your file is never
 * uploaded" browser-enforced.
 *
 *   PORT       port to listen on (default 8080)
 *   DIST_DIR   directory to serve (default ./dist next to this file)
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(process.env.DIST_DIR ?? join(here, 'dist'));
const PORT = Number(process.env.PORT ?? 8080);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`No build found at ${DIST}. Run "npm run build" first.`);
  process.exit(1);
}

// The page fetches nothing after it loads (samples are inlined, the worker is a
// blob), so connect-src can be 'none'.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "connect-src 'none'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
  "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.map']);
const gzipCache = new Map();
const gzipped = (p) => gzipCache.get(p) ?? gzipCache.set(p, gzipSync(readFileSync(p))).get(p);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS }); res.end('Method Not Allowed'); return; }

  let rel;
  try { rel = normalize(decodeURIComponent(url.pathname)); } catch { res.writeHead(400, SECURITY_HEADERS); res.end('Bad Request'); return; }
  let file = resolve(join(DIST, rel));
  if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403, SECURITY_HEADERS); res.end('Forbidden'); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(DIST, 'index.html');

  const ext = extname(file);
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': /[\\/]assets[\\/].+-[A-Za-z0-9_-]{8}\./.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && COMPRESSIBLE.has(ext)) {
    const body = gzipped(file);
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length, Vary: 'Accept-Encoding' });
    return req.method === 'HEAD' ? res.end() : res.end(body);
  }
  res.writeHead(200, { ...headers, 'Content-Length': statSync(file).size, Vary: 'Accept-Encoding' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => console.log(`gridanon-web serving ${DIST} on :${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
