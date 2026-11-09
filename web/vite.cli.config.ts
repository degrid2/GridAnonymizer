import { defineConfig } from 'vite';

/** Bundles the Node CLI into one dependency-free file: dist-cli/gridanon.mjs. */
export default defineConfig({
  root: import.meta.dirname,
  publicDir: false,
  build: {
    ssr: 'cli/gridanon.ts',
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'gridanon.mjs', banner: '#!/usr/bin/env node' } },
  },
  ssr: { target: 'node', noExternal: true },
});
