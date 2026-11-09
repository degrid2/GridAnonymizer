/** PSS/E companion files and zip bundles: twins of PsseAuxTests.cs / ZipBundleTests in the .NET edition. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileAccess, writeZip } from '../cli/node-io.ts';
import { defaultProfile } from '../src/core/profile.ts';
import { blobAccess, entrySource, listZip, readEntry, safeRelativePath, ZipError, ZipWriter, zipToBlob } from '../src/core/zip.ts';
import { out, read, repo, runAnon, runRestore, sample, tempDir } from './helpers.ts';

const raw = sample('psse/meridian_v33.raw');
const con = sample('psse/meridian_v33.con');
const mon = sample('psse/meridian_v33.mon');
const sub = sample('psse/meridian_v33.sub');
const csv = sample('psse/study_results.csv');

function renumbering() {
  const p = defaultProfile();
  p.psse.renumberBuses = true;
  return p;
}

const pad3 = (n: number) => String(n).padStart(3);

describe('PSS/E companion files', () => {
  test('follow the renumbered case', async () => {
    const t = tempDir();
    const r = await runAnon(t.path, [raw, con, mon, sub], { profile: renumbering() });
    assert.ok(r.report.clean, JSON.stringify(r.report.files.map((f) => f.audit)));
    const b = r.mapping.psse.buses;
    const text = read(out(t.path, con));
    assert.ok(text.includes(`OPEN BRANCH FROM BUS ${pad3(b['101'])} TO BUS ${pad3(b['201'])} CIRCUIT 1`), text);
    assert.ok(text.includes(`REMOVE MACHINE 1 FROM BUS ${pad3(b['302'])}`));
    for (const w of ['northwind', 'meridian', 'stonegate', 'nw-rb']) assert.ok(!text.toLowerCase().includes(w), w);
    assert.ok(!text.includes('COM '));
  });

  test('bus ranges are expanded into the new numbers', async () => {
    const t = tempDir();
    const r = await runAnon(t.path, [raw, sub], { profile: renumbering() });
    const b = r.mapping.psse.buses;
    const expected = ['101', '102', '201', '202'].map((k) => b[k]).sort((x, y) => x - y).map((n) => `  BUS ${n}`);
    const lines = read(out(t.path, sub)).split(/\r?\n/);
    assert.deepEqual(lines.slice(1, 5), expected);
    assert.ok(!lines.some((l) => l.includes('BUSES')));
  });

  test('labels are consistent across files and reach results CSVs', async () => {
    const t = tempDir();
    const r = await runAnon(t.path, [raw, con, mon, sub, csv]);
    assert.ok(r.report.clean);
    const label = r.mapping.psse.names['NORTHWIND AREA'];
    assert.match(label, /^SUBSYS_/);
    assert.ok(read(out(t.path, mon)).includes(label));
    assert.ok(read(out(t.path, sub)).includes(label));
    assert.ok(read(out(t.path, csv)).includes(`"${r.mapping.psse.names['NW-RB 345 L1 OUT']}"`));
  });

  test('restore with the mapping', async () => {
    const t = tempDir();
    const p = renumbering();
    p.psse.stripComments = false;
    const r = await runAnon(t.path, [raw, con, mon], { profile: p });
    const back = await runRestore(t.file('back'), [out(t.path, con), out(t.path, mon)], { mapping: r.mapping });
    const norm = (s: string) => s.split('\n').map((l) => l.replace(/\s+/g, ' ').replaceAll("' ", "'").replaceAll(" '", "'").trim()).join('\n');
    for (const [orig, ext] of [[con, '.con'], [mon, '.mon']]) {
      const f = back.report.files.find((x) => x.input.endsWith(ext))!;
      assert.equal(norm(read(f.output!)), norm(read(orig)));
    }
  });

  test('a bus missing from the case is flagged', async () => {
    const t = tempDir();
    const extra = t.write('extra.con', "CONTINGENCY 'X1'\n  OPEN BRANCH FROM BUS 101 TO BUS 999 CIRCUIT 1\nEND\nEND\n");
    const r = await runAnon(t.file('o'), [raw, extra], { profile: renumbering() });
    const f = r.report.files.find((x) => x.format === 'psse-aux')!;
    assert.ok(f.warnings.some((w) => w.includes('999')));
    assert.ok(f.audit!.clean);
  });

  test('warns when renumbering without the case', async () => {
    const t = tempDir();
    const r = await runAnon(t.path, [con], { profile: renumbering() });
    assert.ok(r.report.files[0].warnings.some((w) => w.includes('.raw')));
  });
});

describe('zip', () => {
  test('entry names are normalized', () => {
    const cases: [string, string | null][] = [
      ['a/b.raw', 'a/b.raw'], ['a\\b.con', 'a/b.con'], ['./x.raw', 'x.raw'], ['dir/', null], ['__MACOSX/._x.raw', null], ['a/.DS_Store', null],
    ];
    for (const [name, expected] of cases) assert.equal(safeRelativePath(name), expected, name);
  });

  test('zip slip is refused', () => {
    for (const name of ['../evil.raw', 'a/../../evil.raw', '/etc/passwd', 'C:/Windows/x']) assert.throws(() => safeRelativePath(name), ZipError, name);
  });

  test('write and read round trip', async () => {
    const t = tempDir();
    const zip = t.file('case.zip');
    await writeZip(zip, [{ entryName: 'case/meridian_v33.raw', filePath: raw }, { entryName: 'meridian_v33.con', filePath: con }]);
    const access = await fileAccess(zip);
    try {
      const entries = await listZip(access);
      assert.deepEqual(entries.map((e) => e.path), ['case/meridian_v33.raw', 'meridian_v33.con']);
      const chunks: Uint8Array[] = [];
      for await (const c of readEntry(access, entries[0])) chunks.push(c);
      assert.ok(Buffer.concat(chunks).equals(readFileSync(raw)));
      assert.equal(entrySource(access, entries[1], 'x').size, readFileSync(con).length);
    } finally {
      await access.close();
    }
  });

  test('in-memory zips read back (browser path)', async () => {
    const blob = await zipToBlob([{ name: 'a/empty.txt', data: new Blob([]) }, { name: 'b.txt', data: new Blob(['hello zip']) }]);
    const access = blobAccess(blob);
    const entries = await listZip(access);
    assert.deepEqual(entries.map((e) => [e.path, e.size]), [['a/empty.txt', 0], ['b.txt', 9]]);
    let text = '';
    for await (const c of readEntry(access, entries[1])) text += new TextDecoder().decode(c);
    assert.equal(text, 'hello zip');
  });

  test('corrupt data is detected', async () => {
    const parts: Uint8Array[] = [];
    const w = new ZipWriter((b) => { parts.push(b); });
    await w.add('x.txt', (async function* () { yield new TextEncoder().encode('a'.repeat(1000)); })());
    await w.finish();
    const bytes = new Uint8Array(Buffer.concat(parts));
    bytes[40] ^= 0xff; // inside the deflated data
    const access = blobAccess(new Blob([bytes]));
    const [e] = await listZip(access);
    await assert.rejects(async () => { for await (const _ of readEntry(access, e)) { /* drain */ } });
  });
});

describe('CLI zip bundles', () => {
  const cli = join(repo, 'cli/gridanon.ts');
  const node = (args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, ...args], { encoding: 'utf8' });

  test('a .zip input gives <name>_anonymized.zip with the same layout', async () => {
    const t = tempDir();
    const zip = t.file('meridian.zip');
    await writeZip(zip, [
      { entryName: 'case/meridian_v33.raw', filePath: raw },
      { entryName: 'case/meridian_v33.con', filePath: con },
      { entryName: 'meridian_v33.mon', filePath: mon },
    ]);
    const r = node(['anonymize', zip, '--renumber-buses', '--salt', 's', '-q', '-o', t.file('out')]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(readdirSync(t.file('out')), ['meridian_anonymized.zip']);
    const access = await fileAccess(t.file('out/meridian_anonymized.zip'));
    try {
      const entries = await listZip(access);
      assert.deepEqual(entries.map((e) => e.path).sort(), ['case/meridian_v33.con', 'case/meridian_v33.raw', 'meridian_v33.mon']);
      let text = '';
      for await (const c of readEntry(access, entries.find((e) => e.path.endsWith('.con'))!)) text += Buffer.from(c).toString('latin1');
      assert.ok(!text.includes('NW-RB'));
    } finally {
      await access.close();
    }
  });

  test('--zip puts loose files into one archive', async () => {
    const t = tempDir();
    const r = node(['anonymize', raw, con, '--salt', 's', '-q', '-o', t.file('out'), '--zip', t.file('share.zip')]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(t.file('share.zip')));
    assert.deepEqual(readdirSync(t.file('out')), []);
    const access = await fileAccess(t.file('share.zip'));
    try {
      assert.deepEqual((await listZip(access)).map((e) => e.path).sort(), ['meridian_v33.con', 'meridian_v33.raw']);
    } finally {
      await access.close();
    }
  });
});
