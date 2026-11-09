#!/usr/bin/env node
/**
 * The two editions are self-contained, so a few things exist in both folders.
 * This check fails if the copies drift apart:
 *   dotnet/profiles      == web/profiles
 *   dotnet/samples       == web/samples
 *   dotnet/tests/golden  == web/test/golden
 *   dotnet/src/GridAnonymizer.Cli/wwwroot == web/dist-dotnet  (only when web/dist-dotnet exists:
 *                                            run `npm run build:dotnet-ui` / `vite build --mode dotnet` first)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
const pairs = [
  ['dotnet/profiles', 'web/profiles'],
  ['dotnet/samples', 'web/samples'],
  ['dotnet/tests/golden', 'web/test/golden'],
];
if (existsSync(join(root, 'web/dist-dotnet'))) pairs.push(['dotnet/src/GridAnonymizer.Cli/wwwroot', 'web/dist-dotnet']);

const list = (dir) => {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : out.push(relative(dir, p).replaceAll('\\', '/')); } };
  walk(dir);
  return out.sort();
};

let ok = true;
for (const [a, b] of pairs) {
  const A = join(root, a), B = join(root, b);
  const fa = list(A), fb = list(B);
  const all = [...new Set([...fa, ...fb])].sort();
  for (const f of all) {
    if (!fa.includes(f) || !fb.includes(f)) { console.error(`only in ${fa.includes(f) ? a : b}: ${f}`); ok = false; continue; }
    if (!readFileSync(join(A, f)).equals(readFileSync(join(B, f)))) { console.error(`differs: ${a}/${f} vs ${b}/${f}`); ok = false; }
  }
  console.log(`${ok ? 'ok ' : '...'} ${a} == ${b} (${all.length} files)`);
}
if (!ok) { console.error('\nCopies have drifted. Edit both, or regenerate the UI with `npm run build:dotnet-ui` in web/.'); process.exit(1); }
