import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Two builds of the same page:
 *
 *   vite build                 browser edition → dist/  (engine in a Web Worker,
 *                              no requests after load: connect-src 'none')
 *   vite build --mode dotnet   page for the .NET edition's `gridanon ui` → dist-dotnet/
 *                              (no engine; talks to the local .NET server: connect-src 'self')
 *
 * `base: './'` keeps the browser build host-agnostic (domain root, sub-path, file://).
 */

const csp = (connect: string) =>
  [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    `connect-src ${connect}`, "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join('; ');

// Also delivered as a <meta> tag so hosts that cannot set headers (GitHub Pages)
// still enforce it. Build only: the dev server needs inline scripts and a websocket.
const cspMeta = (policy: string): Plugin => ({
  name: 'gridanon-csp-meta',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n<meta http-equiv="Content-Security-Policy" content="${policy}" data-gridanon-csp />`),
});

export default defineConfig(({ mode }) => {
  const dotnet = mode === 'dotnet';
  return {
    root: import.meta.dirname,
    base: './',
    publicDir: dotnet ? false : 'public',
    plugins: [cspMeta(csp(dotnet ? "'self'" : "'none'"))],
    define: { __GRIDANON_BACKEND__: JSON.stringify(dotnet ? 'dotnet' : 'browser') },
    // The .NET page never runs the engine in the browser: swap the worker backend for a stub.
    resolve: dotnet
      ? { alias: [{ find: /^\.\/backend-worker\.ts$/, replacement: fileURLToPath(new URL('./src/app/backend-none.ts', import.meta.url)) }] }
      : {},
    build: {
      outDir: dotnet ? 'dist-dotnet' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: !dotnet,
      assetsInlineLimit: 0,
      // One script file: the offline single-file page cannot load extra chunks.
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
    // Classic (iife) worker: browsers refuse module workers from blob: URLs on file:// pages.
    worker: { format: 'iife' },
  };
});
