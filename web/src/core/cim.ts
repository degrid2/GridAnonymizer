/**
 * IEC 61970 CIM / CGMES RDF-XML. Line-for-line twin of the .NET CimHandler,
 * CimMapBuilder and CimPatterns: same regular expressions, same ordering, same
 * pseudonyms - test/parity.test.ts asserts byte-identical output.
 */

import { hexDigest, newIdFor } from './hash.ts';
import type { CimMapping, MappingDocument } from './mapping.ts';
import type { CimOptions } from './profile.ts';
import {
  auditResult, count, decode, escapeRe, GlobalRules, NameCounter, netTrim, newReport, NotSupportedError, toRecord,
  type AuditResult, type ByteSource, type FileReport, type FormatHandler, type FormatJob, type JobContext, type OutputFile,
} from './shared.ts';
import { xmlChunks } from './xml-chunker.ts';

interface CimEntity { type: string; name?: string; mrid?: string }

class CimInventory {
  readonly entities = new Map<string, CimEntity>();
  readonly descCount = new Map<string, number>();
  readonly nameSet = new Set<string>();
  readonly nameCount = new Map<string, number>();
  readonly vocabValues = new Set<string>();
  readonly referencedIds = new Set<string>();

  addName(e: CimEntity, name: string): void {
    e.name = name;
    this.nameSet.add(name);
    this.nameCount.set(name, (this.nameCount.get(name) ?? 0) + 1);
  }

  mergeFrom(o: CimInventory): void {
    for (const [id, e] of o.entities) {
      const mine = this.entities.get(id);
      if (!mine) { this.entities.set(id, { type: e.type, name: e.name, mrid: e.mrid }); continue; }
      mine.name ??= e.name;
      mine.mrid ??= e.mrid;
    }
    for (const [d, c] of o.descCount) this.descCount.set(d, (this.descCount.get(d) ?? 0) + c);
    for (const n of o.nameSet) this.nameSet.add(n);
    for (const [n, c] of o.nameCount) this.nameCount.set(n, (this.nameCount.get(n) ?? 0) + c);
    for (const v of o.vocabValues) this.vocabValues.add(v);
    for (const r of o.referencedIds) this.referencedIds.add(r);
  }
}

interface CimMaps {
  ids: Map<string, string>;
  names: Map<string, string>;
  mrids: Map<string, string>;
  descs: Map<string, string>;
  preserved: Set<string>;
  externalCount: number;
}

const emptyMaps = (): CimMaps => ({ ids: new Map(), names: new Map(), mrids: new Map(), descs: new Map(), preserved: new Set(), externalCount: 0 });

const W = '[A-Za-z0-9_]';
const RE_VOCAB = new RegExp(`<${W}+:[A-Za-z0-9_.]*(?:[Tt]ype|Kind)>([^<]*)<`, 'g');
const RE_ENUM_REF = new RegExp(`rdf:resource="http[^"]*#(${W}+)\\.(${W}+)"`, 'g');
const RE_CLASS = new RegExp(`<(${W}+):(${W}+)[\\s>]`, 'g');
const RE_INTERNAL_REF = /rdf:resource="#([^"]*)"|rdf:resource="(urn:uuid:[^"]*)"/g;
const RE_COMMENT = /<!--[\s\S]*?-->/g;
const RE_WORD = /[A-Za-z][A-Za-z0-9]{2,}/g;
const RE_UNSUPPORTED = /rdf:(?:ID|about|resource)\s*=\s*'|<!\[CDATA\[/;
const RE_TEXT_NODE = />([^<]+)</g;
const RE_AUDIT_VALUE = /"([^"]*)"|>([^<>]+)</g;
const RE_AUDIT_TOKEN = /[A-Za-z0-9_][A-Za-z0-9_.-]*/g;
const RE_TYPE_HINT = /_(COMB_CYC|CC|GT|ST|HYDRO|NUC|WIND|SOLAR)$/i;
const RE_SHORT_SUFFIX = /_(BB|CP_BB|[A-Z]{1,3})$/;
const RE_CIRCUIT = /_(\d{1,2})$/;

const alt = (names: Iterable<string>, wrap = true): string => {
  const list = [...names].filter((s) => s.length > 0).map(escapeRe);
  if (list.length === 0) return '(?!)';
  return wrap ? `(?:${list.join('|')})` : list.join('|');
};

class CimPatterns {
  readonly scan: RegExp;
  readonly rewrite: RegExp;

  constructor(o: CimOptions) {
    const names = alt(o.nameProperties);
    const descs = alt(o.descriptionProperties);
    const headers = alt(Object.keys(o.headerProperties), false);
    const overwrite = alt(Object.keys(o.overwriteProperties));
    const A = '(?:\\s[^>/]*)?';
    this.scan = new RegExp(
      `<(${W}+):(${W}+)\\s+(?:[^>]*?\\s)?rdf:(ID|about)="([^"]*)"` +
        `|<${W}+:${names}${A}>([^<]*)<` +
        `|<${W}+:IdentifiedObject\\.mRID${A}>([^<]*)<` +
        `|<${W}+:${descs}${A}>([^<]*)<`,
      'g',
    );
    this.rewrite = new RegExp(
      `(?<idPre><${W}+:${W}+\\s+(?:[^>]*?\\s)?rdf:(?:ID|about)=")(?<id>[^"]*)"` +
        '|(?<refPre>rdf:resource="#)(?<ref>[^"]*)"' +
        `|(?<namePre><${W}+:${names}${A}>)(?<name>[^<]*)<` +
        `|(?<mridPre><${W}+:IdentifiedObject\\.mRID${A}>)(?<mrid>[^<]*)<` +
        `|(?<descPre><${W}+:${descs}${A}>)(?<desc>[^<]*)<` +
        '|(?<urnPre>rdf:resource="urn:uuid:)(?<urn>[^"]*)"' +
        `|(?<hdrPre><(?<hdrTag>${headers})>)(?<hdr>[^<]*)<` +
        `|(?<owPre><${W}+:(?<owTag>${overwrite})>)(?<ow>[^<]*)<`,
      'g',
    );
  }
}

const localType = (q: string) => q.slice(q.indexOf(':') + 1);

function buildMaps(inv: CimInventory, o: CimOptions, rules: GlobalRules, salt: string, pre?: CimMapping): CimMaps {
  const maps = emptyMaps();
  if (pre) {
    for (const [k, v] of Object.entries(pre.ids)) maps.ids.set(k, v);
    for (const [k, v] of Object.entries(pre.names)) maps.names.set(k, v);
    for (const [k, v] of Object.entries(pre.mrids)) maps.mrids.set(k, v);
    for (const [k, v] of Object.entries(pre.descriptions)) maps.descs.set(k, v);
    for (const p of pre.preserved) maps.preserved.add(p);
  }
  const sensitive = new Set(o.sensitiveClasses);
  const numericOk = new Set(o.numericNameClasses);
  const prefixFor = (t: string) => (Object.hasOwn(o.classPrefixes, localType(t)) ? o.classPrefixes[localType(t)] : o.defaultPrefix);
  const isSensitive = (e: CimEntity) => sensitive.has(localType(e.type));
  const names = new NameCounter(maps.names.values());

  const tokenOwner = new Map<string, string>();
  for (const [id, e] of inv.entities) {
    if (e.name === undefined || !isSensitive(e)) continue;
    for (const w of e.name.match(RE_WORD) ?? []) {
      const t = w.toUpperCase();
      if (t.length >= 4 && !tokenOwner.has(t)) tokenOwner.set(t, id);
    }
    const whole = e.name.toUpperCase();
    if (whole.length >= 4 && !tokenOwner.has(whole)) tokenOwner.set(whole, id);
  }
  const sensitiveNames = new Set<string>();
  for (const e of inv.entities.values()) if (e.name !== undefined && isSensitive(e)) sensitiveNames.add(e.name);
  const kvNames = new Set<string>();
  for (const e of inv.entities.values())
    if (e.name !== undefined && numericOk.has(localType(e.type)) && /^[\d.]+$/.test(netTrim(e.name))) kvNames.add(e.name);

  const isVocabulary = (n: string) =>
    rules.isPreserved(n) || (!sensitiveNames.has(n) && ((inv.nameCount.get(n) ?? 0) >= o.vocabularyMinCount || inv.vocabValues.has(n)));

  if (o.anonymizeIds) {
    const keep = o.preserveIdPatterns.map((p) => new RegExp(p));
    const keepId = (id: string) => keep.some((r) => r.test(id));
    for (const id of inv.entities.keys()) if (!maps.ids.has(id) && !keepId(id)) maps.ids.set(id, newIdFor(salt, id));
    for (const id of inv.referencedIds) {
      if (maps.ids.has(id) || !o.anonymizeExternalReferences || keepId(id) || inv.entities.has(id)) continue;
      maps.ids.set(id, newIdFor(salt, id));
      maps.externalCount++;
    }
  }

  if (o.anonymizeNames) {
    const order = [...inv.entities].sort((a, b) => (isSensitive(b[1]) ? 1 : 0) - (isSensitive(a[1]) ? 1 : 0));
    const newNameOf = new Map<string, string>();
    for (const [id, e] of order) {
      if (e.name === undefined) continue;
      const type = localType(e.type);
      if (kvNames.has(e.name) || isVocabulary(e.name)) {
        newNameOf.set(id, e.name);
        maps.names.set(e.name, e.name);
        maps.preserved.add(e.name);
        continue;
      }
      const existing = maps.names.get(e.name);
      if (existing !== undefined && !newNameOf.has(id)) {
        newNameOf.set(id, existing);
        continue;
      }
      const prefix = prefixFor(e.type);
      let generated: string;
      const upper = e.name.toUpperCase();
      let ownerId: string | undefined;
      let bestLen = 0;
      if (tokenOwner.has(upper)) { ownerId = tokenOwner.get(upper); bestLen = upper.length; }
      for (const w of upper.match(RE_WORD) ?? []) {
        const owner = tokenOwner.get(w);
        if (owner === undefined || owner === id) continue;
        if (w.length > bestLen) { ownerId = owner; bestLen = w.length; }
      }
      if (ownerId === id) ownerId = undefined;

      if (ownerId !== undefined && !sensitive.has(type)) {
        const ownerEntity = inv.entities.get(ownerId);
        const ownerNew = newNameOf.get(ownerId) ?? maps.names.get(ownerEntity?.name ?? '') ?? names.nextName(prefixFor(ownerEntity?.type ?? 'x:Substation'));
        const seq = names.next(ownerNew + '#');
        generated = `${ownerNew}_${prefix[0]}${String(seq).padStart(4, '0')}`;
        if (names.isUsed(generated)) generated = names.nextName(prefix);
        else names.markUsed(generated);
      } else if (o.keepTypeHints && RE_TYPE_HINT.test(e.name)) {
        generated = names.nextName(prefix) + RE_TYPE_HINT.exec(e.name)![0].toUpperCase();
        names.markUsed(generated);
      } else {
        generated = names.nextName(prefix);
        const suf = RE_SHORT_SUFFIX.exec(e.name);
        const circuit = RE_CIRCUIT.exec(e.name);
        if (suf && !/^\d+$/.test(suf[1])) generated = `${generated}_${suf[1]}`;
        else if (circuit) generated = `${generated}_${circuit[1]}`;
      }
      newNameOf.set(id, generated);
      maps.names.set(e.name, generated);
    }
  }

  if (o.anonymizeMrids && o.anonymizeIds) {
    for (const [id, e] of inv.entities) {
      if (e.mrid === undefined || maps.mrids.has(e.mrid)) continue;
      const newId = maps.ids.get(id);
      if (newId === undefined) continue;
      maps.mrids.set(e.mrid, newId.startsWith('_') ? newId.slice(1) : newId);
    }
  }

  if (o.anonymizeDescriptions) {
    for (const [desc, c] of inv.descCount) {
      if (maps.descs.has(desc)) continue;
      const generic = (c >= o.vocabularyMinCount && !inv.nameSet.has(desc)) || rules.isPreserved(desc);
      maps.descs.set(desc, generic ? desc : maps.names.get(desc) ?? 'DESC_' + hexDigest(salt, 'd ' + desc, 6));
    }
  }
  return maps;
}

function invert(m: CimMapping): CimMaps {
  const maps = emptyMaps();
  const inv = (src: Record<string, string>, dst: Map<string, string>) => {
    for (const [k, v] of Object.entries(src)) if (k !== v && !dst.has(v)) dst.set(v, k);
  };
  inv(m.ids, maps.ids);
  inv(m.names, maps.names);
  inv(m.mrids, maps.mrids);
  inv(m.descriptions, maps.descs);
  return maps;
}

class CimJob implements FormatJob {
  private readonly patterns: CimPatterns;
  private readonly rules: GlobalRules;
  private readonly merged = new CimInventory();
  private readonly perFile = new Map<string, CimInventory>();
  private maps?: CimMaps;
  private readonly ctx: JobContext;

  constructor(ctx: JobContext) {
    this.ctx = ctx;
    this.patterns = new CimPatterns(ctx.profile.cim);
    this.rules = new GlobalRules(ctx.profile);
  }

  async scan(source: ByteSource): Promise<void> {
    const inv = await this.scanFile(source);
    this.perFile.set(source.name, inv);
    this.merged.mergeFrom(inv);
  }

  private async scanFile(source: ByteSource): Promise<CimInventory> {
    const inv = new CimInventory();
    let current: CimEntity | undefined;
    for await (const raw of xmlChunks(decode(source, 'utf8'))) {
      const body = raw.replace(RE_COMMENT, '');
      const bad = RE_UNSUPPORTED.exec(body);
      if (bad)
        throw new NotSupportedError(
          `${source.name}: contains ${bad[0].startsWith('<') ? 'a CDATA section' : 'a single-quoted rdf attribute'}, ` +
            'which this version cannot anonymize safely. Re-export with double-quoted attributes and no CDATA, or open an issue.',
        );
      for (const m of body.matchAll(RE_VOCAB)) if (m[1].length > 0 && !m[1].startsWith('http')) inv.vocabValues.add(m[1]);
      for (const m of body.matchAll(RE_ENUM_REF)) { inv.vocabValues.add(m[2]); inv.vocabValues.add(m[1]); }
      for (const m of body.matchAll(RE_CLASS)) inv.vocabValues.add(m[2]);
      for (const m of body.matchAll(RE_INTERNAL_REF)) inv.referencedIds.add(m[1] ?? m[2]);
      for (const m of body.matchAll(this.patterns.scan)) {
        if (m[4] !== undefined) {
          const id = m[4].startsWith('#') ? m[4].slice(1) : m[4];
          current = inv.entities.get(id);
          if (!current) { current = { type: `${m[1]}:${m[2]}` }; inv.entities.set(id, current); }
        } else if (m[5] !== undefined && current) {
          if (current.name === undefined) inv.addName(current, m[5]);
        } else if (m[6] !== undefined && current) {
          current.mrid = m[6];
        } else if (m[7] !== undefined) {
          inv.descCount.set(m[7], (inv.descCount.get(m[7]) ?? 0) + 1);
        }
      }
    }
    return inv;
  }

  buildMaps(): void {
    if (this.ctx.restore) {
      if (!this.ctx.mapping) throw new Error('restore needs a mapping');
      this.maps = invert(this.ctx.mapping.cim);
      return;
    }
    this.maps = buildMaps(this.merged, this.ctx.profile.cim, this.rules, this.ctx.salt, this.ctx.mapping?.cim);
  }

  async rewrite(source: ByteSource, out: OutputFile): Promise<FileReport> {
    const maps = this.maps!;
    const o = this.ctx.profile.cim;
    const restore = this.ctx.restore;
    const report = newReport(source, 'cim');
    report.output = out.name;
    const escape = (mapped: string, orig: string) =>
      mapped === orig ? mapped : mapped.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const evaluate = (...args: unknown[]): string => {
      const m = args[0] as string;
      const g = args[args.length - 1] as Record<string, string | undefined>;
      if (g.idPre !== undefined) {
        const raw = g.id!;
        const hash = raw.startsWith('#');
        const mapped = maps.ids.get(hash ? raw.slice(1) : raw);
        if (mapped !== undefined) { count(report, 'ids'); return g.idPre + (hash ? '#' : '') + mapped + '"'; }
        return m;
      }
      if (g.refPre !== undefined) {
        const mapped = maps.ids.get(g.ref!);
        if (mapped !== undefined) { count(report, 'refs'); return g.refPre + mapped + '"'; }
        count(report, 'unmappedRefs');
        return m;
      }
      if (g.namePre !== undefined) {
        const mapped = maps.names.get(g.name!);
        if (mapped !== undefined) { count(report, 'names'); return g.namePre + escape(mapped, g.name!) + '<'; }
        return m;
      }
      if (g.mridPre !== undefined) {
        const mapped = maps.mrids.get(g.mrid!);
        if (mapped !== undefined) { count(report, 'mrids'); return g.mridPre + mapped + '<'; }
        return m;
      }
      if (g.descPre !== undefined) {
        const mapped = maps.descs.get(g.desc!);
        if (mapped !== undefined) { count(report, 'descriptions'); return g.descPre + escape(mapped, g.desc!) + '<'; }
        return m;
      }
      if (g.urnPre !== undefined) {
        const mapped = maps.ids.get('urn:uuid:' + g.urn);
        if (mapped !== undefined) {
          count(report, 'refs');
          return g.urnPre + (mapped.startsWith('urn:uuid:') ? mapped.slice(9) : mapped) + '"';
        }
        count(report, 'unmappedRefs');
        return m;
      }
      if (g.hdrPre !== undefined) {
        if (restore || !o.replaceHeaders || !Object.hasOwn(o.headerProperties, g.hdrTag!)) return m;
        count(report, 'headers');
        return g.hdrPre + o.headerProperties[g.hdrTag!].replaceAll('{hash8}', hexDigest(this.ctx.salt, 'mas ' + g.hdr, 8)) + '<';
      }
      if (g.owPre !== undefined) {
        if (restore || !Object.hasOwn(o.overwriteProperties, g.owTag!)) return m;
        count(report, 'overwritten');
        return g.owPre + o.overwriteProperties[g.owTag!] + '<';
      }
      return m;
    };

    try {
      for await (const raw of xmlChunks(decode(source, 'utf8'))) {
        let text = raw;
        if (o.stripComments && !restore) text = text.replace(RE_COMMENT, () => { count(report, 'comments'); return ''; });
        text = text.replace(this.patterns.rewrite, evaluate);
        if (this.rules.hasRedactions && !restore)
          text = text.replace(RE_TEXT_NODE, (_m, inner: string) => '>' + this.rules.redactText(inner, report) + '<');
        await out.sink.write(text);
      }
    } catch (e) {
      await out.abort();
      throw e;
    }
    const written = await out.commit();
    report.bytesOut = written.size;
    if (maps.externalCount > 0) report.stats.externalIds = maps.externalCount;
    return report;
  }

  async audit(original: ByteSource, output: ByteSource): Promise<AuditResult> {
    let inv = this.perFile.get(original.name);
    if (!inv) { inv = await this.scanFile(original); this.perFile.set(original.name, inv); }
    const o = this.ctx.profile.cim;
    const origNames = new Set<string>();
    let origIds = new Set<string>();
    for (const [id, e] of inv.entities) {
      if (this.maps && !this.maps.ids.has(id)) { if (e.name !== undefined) origNames.add(e.name); continue; }
      origIds.add(id);
      if (e.name !== undefined) origNames.add(e.name);
    }
    const preserved = this.maps?.preserved ?? new Set<string>();
    const vocabulary = new Set<string>();
    for (const [n, c] of inv.nameCount) if (c >= o.vocabularyMinCount) vocabulary.add(n);
    for (const n of origNames) if (inv.vocabValues.has(n) || preserved.has(n)) vocabulary.add(n);
    let hunted = new Set<string>();
    for (const n of origNames) if (n.length >= 4 && /[A-Za-z]/.test(n) && !vocabulary.has(n)) hunted.add(n);
    if (!o.anonymizeNames) hunted = new Set();
    if (!o.anonymizeIds) origIds = new Set();

    const leakedNames = new Set<string>();
    const leakedIds = new Set<string>();
    const leakedTerms = new Set<string>();
    for await (const chunk of xmlChunks(decode(output, 'utf8'))) {
      for (const m of chunk.matchAll(RE_AUDIT_VALUE)) {
        const value = m[1] ?? m[2] ?? '';
        if (value.length === 0) continue;
        if (hunted.has(value)) leakedNames.add(value);
        if (origIds.has(value)) leakedIds.add(value);
        if (value.length > 4 && /[ _/#:-]/.test(value)) {
          for (const t of value.matchAll(RE_AUDIT_TOKEN)) {
            if (hunted.has(t[0])) leakedNames.add(t[0]);
            if (origIds.has(t[0])) leakedIds.add(t[0]);
          }
        }
      }
      if (this.rules.hasRedactions) for (const m of chunk.matchAll(RE_TEXT_NODE)) for (const t of this.rules.findTerms(m[1])) leakedTerms.add(t);
    }
    return auditResult({
      hunted: hunted.size + this.rules.redactTerms.length,
      vocabularyExcluded: vocabulary.size,
      leakedNames: [...leakedNames].sort().slice(0, 20),
      leakedIds: [...leakedIds].sort().slice(0, 20),
      leakedTerms: [...leakedTerms].sort(),
    });
  }

  exportTo(mapping: MappingDocument): void {
    if (!this.maps || this.ctx.restore) return;
    mapping.cim.ids = toRecord(new Map([...Object.entries(mapping.cim.ids), ...this.maps.ids]));
    mapping.cim.names = toRecord(new Map([...Object.entries(mapping.cim.names), ...this.maps.names]));
    mapping.cim.mrids = toRecord(new Map([...Object.entries(mapping.cim.mrids), ...this.maps.mrids]));
    mapping.cim.descriptions = toRecord(new Map([...Object.entries(mapping.cim.descriptions), ...this.maps.descs]));
    mapping.cim.preserved = [...new Set([...mapping.cim.preserved, ...this.maps.preserved])];
  }
}

export const cimHandler: FormatHandler = {
  id: 'cim',
  description: 'CIM / CGMES RDF-XML (IEC 61970-552), single files or multi-profile sets',
  extensions: ['.xml', '.rdf'],
  encoding: 'utf8',
  sniff: (head) => head.includes('rdf:RDF') || head.includes('22-rdf-syntax-ns'),
  createJob: (ctx) => new CimJob(ctx),
};
