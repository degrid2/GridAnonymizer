/** Unit and golden tests for the TypeScript core. Mirrors dotnet/tests. Run: npm test */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { newIdFor } from '../src/core/hash.ts';
import { parseMapping } from '../src/core/mapping.ts';
import { defaultProfile, loadProfile } from '../src/core/profile.ts';
import { tokenize, tokInner } from '../src/core/psse.ts';
import { memorySource, netTrim, NotSupportedError, readLines } from '../src/core/shared.ts';
import { chunkConfig } from '../src/core/xml-chunker.ts';
import { golden, out, read, repo, runAnon, runRestore, sample, tempDir } from './helpers.ts';

describe('CIM', () => {
  for (const [s, g] of [['cim/sample-network.xml', 'sample-network.v1-golden.xml'], ['cim/cgmes_eq_uuid.xml', 'cgmes_eq_uuid.v1-golden.xml']]) {
    test(`${s} is byte-identical to the v1 engine`, async () => {
      const t = tempDir();
      await runAnon(t.path, [sample(s)]);
      assert.equal(read(out(t.path, sample(s))), read(golden(g)));
    });
  }

  test('tiny chunks produce the same output as one chunk', async () => {
    const a = tempDir();
    const b = tempDir();
    const input = sample('cim/cgmes_eq_uuid.xml');
    await runAnon(a.path, [input]);
    chunkConfig.size = 37;
    try {
      assert.ok((await runAnon(b.path, [input])).report.clean);
    } finally {
      chunkConfig.size = 1 << 20;
    }
    assert.equal(read(out(a.path, input)), read(out(b.path, input)));
  });

  test('multi-profile set joins with SSH listed before EQ', async () => {
    const t = tempDir();
    const head = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#">\n';
    const eq = t.write('EQ.xml', head + '<cim:Substation rdf:ID="_s1"><cim:IdentifiedObject.name>CEDAR HILL</cim:IdentifiedObject.name></cim:Substation>\n<cim:SynchronousMachine rdf:ID="_g1"><cim:IdentifiedObject.name>CEDAR HILL G1</cim:IdentifiedObject.name></cim:SynchronousMachine>\n</rdf:RDF>\n');
    const ssh = t.write('SSH.xml', head + '<cim:SynchronousMachine rdf:about="#_g1"><cim:RotatingMachine.p>120</cim:RotatingMachine.p></cim:SynchronousMachine>\n</rdf:RDF>\n');
    const r = await runAnon(t.file('o'), [ssh, eq]);
    assert.ok(r.report.clean);
    assert.ok(!read(out(t.file('o'), eq)).includes('CEDAR'));
    assert.ok(read(out(t.file('o'), ssh)).includes(`rdf:about="#${r.mapping.cim.ids._g1}"`));
    assert.equal(r.mapping.cim.names['CEDAR HILL G1'], 'SUB_0001_G0001');
  });

  test('refuses single-quoted attributes and CDATA instead of half-anonymizing', async () => {
    const t = tempDir();
    const f = t.write('a.xml', "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><cim:Substation rdf:ID='_s1'/></rdf:RDF>");
    await assert.rejects(runAnon(t.file('o'), [f]), NotSupportedError);
  });

  test('restore reverses ids and names', async () => {
    const t = tempDir();
    const input = sample('cim/sample-network.xml');
    const p = defaultProfile();
    p.cim.stripComments = false;
    const r = await runAnon(t.path, [input], { profile: p });
    const back = await runRestore(t.file('back'), [out(t.path, input)], { mapping: r.mapping });
    assert.equal(read(back.report.files[0].output!), read(input));
  });

  test('ids keep their shape', () => {
    assert.match(newIdFor('s', '_1234'), /^_\d{10}$/);
    assert.match(newIdFor('s', '_5f1c2b7a-1d2e-4f3a-8b9c-0d1e2f3a4b5c'), /^_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(newIdFor('s', 'urn:uuid:5f1c2b7a-1d2e-4f3a-8b9c-0d1e2f3a4b5c'), /^urn:uuid:[0-9a-f]{8}-/);
    assert.match(newIdFor('s', 'SUBSTATION-A'), /^_[0-9a-f]{24}$/);
  });
});

describe('PSS/E', () => {
  const V33 = sample('psse/meridian_v33.raw');
  const V35 = sample('psse/meridian_v35.raw');
  const renumbering = () => { const p = defaultProfile(); p.psse.renumberBuses = true; return p; };

  for (const s of [V33, V35]) {
    test(`names, titles and comments removed: ${s.replace(/^.*[\\/]/, '')}`, async () => {
      const t = tempDir();
      const r = await runAnon(t.path, [s]);
      assert.ok(r.report.clean);
      const text = read(out(t.path, s));
      for (const w of ['NORTHWIND', 'RIVERBEND', 'MERIDIAN', 'Meridian', 'CONFIDENTIAL']) assert.ok(!text.includes(w), w);
      assert.ok(text.includes('END OF BUS DATA, BEGIN LOAD DATA'));
    });
  }

  test('renumbering is consistent everywhere a bus is referenced', async () => {
    const t = tempDir();
    const r = await runAnon(t.path, [V33], { profile: renumbering() });
    const f = r.report.files[0];
    assert.ok(f.audit!.clean, f.audit!.integrityIssues.join(';'));
    assert.equal(Object.keys(r.mapping.psse.buses).length, 7);
    assert.equal(f.stats.busNumbers, 31);
  });

  test('refuses to renumber GNE data, still anonymizes names', async () => {
    const t = tempDir();
    const lines = read(V33).split('\n');
    const at = lines.findIndex((l) => l.includes('BEGIN GNE DEVICE DATA'));
    lines.splice(at + 1, 0, "'MYGNE','GNEMODEL',2,101,201,0,0,0,1,1,0");
    const f = t.write('gne.raw', lines.join('\n'));
    await assert.rejects(runAnon(t.file('o'), [f], { profile: renumbering() }), /GNE/);
    assert.ok((await runAnon(t.file('o2'), [f])).report.clean);
  });

  test('restore round-trips names and bus numbers', async () => {
    const t = tempDir();
    const p = renumbering();
    p.psse.stripComments = false;
    p.psse.replaceCaseTitle = false;
    const r = await runAnon(t.path, [V33], { profile: p });
    const back = await runRestore(t.file('back'), [out(t.path, V33)], { mapping: r.mapping });
    const norm = (path: string) => read(path).split(/\r?\n/).map((l) => tokenize(l).tokens.map((tk) => netTrim(tokInner(l, tk))).join('|'));
    assert.deepEqual(norm(back.report.files[0].output!), norm(V33));
  });

  test('companion CSV gets the same pseudonyms and restores exactly', async () => {
    const t = tempDir();
    const csv = sample('psse/study_results.csv');
    const r = await runAnon(t.path, [V33, V35, csv]);
    assert.ok(r.report.clean);
    assert.ok(!read(out(t.path, csv)).includes('NORTHWIND'));
    const back = await runRestore(t.file('back'), [out(t.path, csv)], { mapping: r.mapping });
    assert.equal(read(back.report.files[0].output!), read(csv));
  });

  for (const nl of ['\r\n', '\n']) {
    test(`keeps ${JSON.stringify(nl)} line endings`, async () => {
      const t = tempDir();
      const raw = t.write('case.raw', read(V33).split('\n').filter((l, i, a) => i < a.length - 1 || l).join(nl) + nl);
      await runAnon(t.file('o'), [raw]);
      const text = read(out(t.file('o'), raw));
      assert.equal(text.includes('\r\n'), nl === '\r\n');
      assert.ok(text.endsWith(nl));
    });
  }

  test('tokenizer handles defaults, quotes and comments', () => {
    const l = "101,'A B',,3 / c";
    const { tokens, commentStart } = tokenize(l);
    assert.deepEqual(tokens.map((t) => tokInner(l, t)), ['101', 'A B', '', '3']);
    assert.equal(commentStart, 13);
  });
});

describe('shared', () => {
  test('readLines splits like .NET ReadLine, across chunk boundaries', async () => {
    async function* chunks() { yield 'a\r'; yield '\nb\rc\n'; yield '\nd'; }
    const lines: string[] = [];
    for await (const l of readLines(chunks())) lines.push(l);
    assert.deepEqual(lines, ['a', 'b', 'c', '', 'd']);
  });

  test('every shared profile loads', () => {
    for (const f of readdirSync(join(repo, 'profiles'))) {
      const p = loadProfile(readFileSync(join(repo, 'profiles', f), 'utf8'));
      assert.ok(p.name.length > 0 && p.cim.classPrefixes.Substation === 'SUB', f);
    }
  });

  test('a mapping written by the .NET edition parses', () => {
    const m = parseMapping(JSON.stringify({ format: 'gridanon-mapping/1', salt: 'x', created: '2026-11-07T22:45:46.4058234+00:00', cim: { ids: { _1: '_2' } }, psse: { buses: { '101': 4 } } }));
    assert.equal(m.cim.ids._1, '_2');
    assert.equal(m.psse.buses['101'], 4);
    assert.deepEqual(m.psse.names, {});
  });

  test('memory sources detect formats', async () => {
    const { detectFormat } = await import('../src/core/engine.ts');
    assert.equal((await detectFormat(memorySource('x.xml', read(sample('cim/sample-network.xml')))))?.id, 'cim');
    assert.equal((await detectFormat(memorySource('x.dat', read(sample('psse/meridian_v35.raw')))))?.id, 'psse');
    assert.equal((await detectFormat(memorySource('x.csv', 'a,b')))?.id, 'text');
  });
});
