/**
 * Cross-edition parity: the TypeScript and .NET editions must produce
 * byte-identical files for the same inputs, salt and profile.
 *
 * Needs a .NET edition binary: set GRIDANON_DOTNET to its path (a release
 * download, or your own `dotnet publish` output).
 * Skipped (not failed) when no .NET binary is found.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileAccess, writeZip } from '../cli/node-io.ts';
import { listZip, readEntry } from '../src/core/zip.ts';
import { repo, tempDir } from './helpers.ts';

// GRIDANON_DOTNET points at a .NET edition binary; a sibling ../dotnet checkout is picked up too.
const candidates = [process.env.GRIDANON_DOTNET && resolve(process.env.GRIDANON_DOTNET), join(repo, '../dotnet/out/gridanon'), join(repo, '../dotnet/out/gridanon.exe')];
const dotnet = candidates.find((c) => c && existsSync(c));
const tsCli = join(repo, 'cli/gridanon.ts');

const configs: string[][] = [
  [],
  ['--renumber-buses', '--redact', 'Meridian'],
  ['-p', join(repo, 'profiles/vendor-strict.json')],
  ['-p', join(repo, 'profiles/cgmes-boundary.json')],
  ['-p', join(repo, 'profiles/names-only.json')],
  ['--keep-comments', '--keep-titles', '--renumber-buses'],
];

for (const cfg of configs) {
  test(`parity [${cfg.map((c) => c.replace(/^.*[\\/]/, '')).join(' ') || 'default'}]`, { skip: !dotnet && 'no .NET gridanon binary (set GRIDANON_DOTNET)' }, () => {
    const t = tempDir();
    const inputs = [join(repo, 'samples/cim'), join(repo, 'samples/psse')];
    const common = ['anonymize', ...inputs, '--salt', 'parity', '-q', ...cfg];
    const net = spawnSync(dotnet!, [...common, '-o', t.file('net'), '-m', t.file('net.json')], { encoding: 'utf8' });
    const ts = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tsCli, ...common, '-o', t.file('ts'), '-m', t.file('ts.json')], { encoding: 'utf8' });
    assert.equal(ts.status, net.status, `exit codes differ: ${net.stderr} ${ts.stderr}`);
    const names = readdirSync(t.file('net')).sort();
    assert.deepEqual(readdirSync(t.file('ts')).sort(), names);
    for (const n of names) assert.ok(readFileSync(join(t.file('net'), n)).equals(readFileSync(join(t.file('ts'), n))), `${n} differs`);
    const a = JSON.parse(readFileSync(t.file('net.json'), 'utf8'));
    const b = JSON.parse(readFileSync(t.file('ts.json'), 'utf8'));
    assert.deepEqual(b.cim, a.cim);
    assert.deepEqual(b.psse, a.psse);
  });
}

// Zip bundles: both editions read a zip written by the TypeScript writer, and the
// entries of their output zips are identical (the zip bytes themselves differ).
test('parity [zip bundle]', { skip: !dotnet && 'no .NET gridanon binary (set GRIDANON_DOTNET)' }, async () => {
  const t = tempDir();
  const psse = join(repo, 'samples/psse');
  const bundle = t.file('meridian.zip');
  await writeZip(bundle, readdirSync(psse).sort().map((n) => ({ entryName: (n.endsWith('.raw') ? 'case/' : 'study/') + n, filePath: join(psse, n) })));
  const common = ['anonymize', bundle, '--salt', 'parity', '-q', '--renumber-buses'];
  const net = spawnSync(dotnet!, [...common, '-o', t.file('net')], { encoding: 'utf8' });
  const ts = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tsCli, ...common, '-o', t.file('ts')], { encoding: 'utf8' });
  assert.equal(ts.status, net.status, `exit codes differ: ${net.stderr} ${ts.stderr}`);
  const contents = async (zip: string) => {
    const access = await fileAccess(zip);
    try {
      const result: Record<string, string> = {};
      for (const e of await listZip(access)) {
        const parts: Uint8Array[] = [];
        for await (const c of readEntry(access, e)) parts.push(c);
        result[e.path] = Buffer.concat(parts).toString('base64');
      }
      return result;
    } finally {
      await access.close();
    }
  };
  const a = await contents(t.file('net/meridian_anonymized.zip'));
  assert.equal(Object.keys(a).length, readdirSync(psse).length);
  assert.deepEqual(await contents(t.file('ts/meridian_anonymized.zip')), a);
});
