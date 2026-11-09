#!/usr/bin/env node
/**
 * Inline the built page into ONE self-contained file, dist/gridanon-web.html,
 * for air-gapped use: double-click to open from disk (file://), no server,
 * no network. Zero dependencies.
 *
 * Browsers refuse external module scripts from file://, so the script and
 * stylesheet are inlined. The inline script is allowed by a CSP hash rather
 * than 'unsafe-inline', and connect-src 'none' still blocks every request.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

const scriptTag = html.match(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/);
const cssTag = html.match(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/);
if (!scriptTag || !cssTag) throw new Error('build-offline: unexpected index.html layout; run `vite build` first');

// Drop the trailing source-map comment only (the inlined worker string carries its own).
const js = readFileSync(join(dist, scriptTag[1]), 'utf8').replace(/\n\/\/# sourceMappingURL=[^\n]*\s*$/, '').replaceAll('</script', '<\\/script');
const css = readFileSync(join(dist, cssTag[1]), 'utf8');
const hash = createHash('sha256').update(js).digest('base64');

const csp = [
  "default-src 'none'",
  `script-src 'sha256-${hash}'`,
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "worker-src blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

html = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*data-gridanon-csp[^>]*>\n?/, '') // replaced by the hash-based policy below
  .replace(scriptTag[0], () => '')
  .replace(cssTag[0], () => `<style>${css}</style>`)
  .replace('<meta charset="utf-8" />', () => `<meta charset="utf-8" />\n<meta http-equiv="Content-Security-Policy" content="${csp}" />`)
  .replace('</body>', () => `<script type="module">${js}</script>\n</body>`);

writeFileSync(join(dist, 'gridanon-web.html'), html);
console.log(`dist/gridanon-web.html  ${(html.length / 1024).toFixed(0)} KB  (script sha256-${hash.slice(0, 12)}…)`);
