/**
 * PSS/E power-flow RAW, revisions 30-35. Twin of the .NET RawWalker and
 * PsseHandler: same tokenizer, section rules, bus-field table, pseudonyms and
 * audit, so both editions produce byte-identical files.
 */

import { hexDigest } from './hash.ts';
import type { MappingDocument } from './mapping.ts';
import type { PsseOptions } from './profile.ts';
import {
  auditResult, count, decode, detectNewLine, GlobalRules, NameCounter, netTrim, netTrimEnd, newReport, NotSupportedError, readLines,
  type AuditResult, type ByteSource, type FileReport, type FormatHandler, type FormatJob, type JobContext, type OutputFile,
} from './shared.ts';

type Section =
  | 'CaseId' | 'SystemWide' | 'Bus' | 'Load' | 'FixedShunt' | 'Generator' | 'Branch' | 'SwitchingDevice' | 'Transformer'
  | 'Area' | 'TwoTerminalDc' | 'VscDc' | 'ImpedanceCorrection' | 'MultiTerminalDc' | 'MultiSectionLine' | 'Zone'
  | 'InterAreaTransfer' | 'Owner' | 'Facts' | 'SwitchedShunt' | 'Gne' | 'InductionMachine' | 'Substation' | 'End' | 'Unknown';

type LineKind = 'Passthrough' | 'CaseId' | 'Title' | 'Data' | 'Terminator' | 'End' | 'Trailer';

export interface RawToken { start: number; length: number; quoted: boolean }

const tokText = (line: string, t: RawToken) => line.substr(t.start, t.length);
export const tokInner = (line: string, t: RawToken) => (t.quoted && t.length >= 2 ? line.substr(t.start + 1, t.length - 2) : tokText(line, t));

interface RawLine {
  text: string;
  kind: LineKind;
  section: Section;
  recordLine: number;
  subBlock: number;
  tokens: RawToken[];
  commentStart: number;
  titleIndex: number;
}

const KEYS: Partial<Record<Section, string>> = {
  SystemWide: 'system-wide', FixedShunt: 'fixed-shunt', SwitchingDevice: 'switching-device', TwoTerminalDc: 'two-terminal-dc',
  VscDc: 'vsc-dc', ImpedanceCorrection: 'impedance-correction', MultiTerminalDc: 'multi-terminal-dc',
  MultiSectionLine: 'multi-section-line', InterAreaTransfer: 'inter-area-transfer', SwitchedShunt: 'switched-shunt',
  InductionMachine: 'induction-machine',
};
const sectionKey = (l: RawLine): string => {
  if (l.section === 'Substation') return ['substation', 'substation-node', 'substation-switching-device', 'substation-equipment'][l.subBlock] ?? 'substation';
  return KEYS[l.section] ?? l.section.toLowerCase();
};
const comment = (l: RawLine) => (l.commentStart < 0 ? '' : l.text.slice(l.commentStart + 1));

/** Split a RAW line into fields: comma or blank separated, ",," is an empty field, '/' outside quotes starts a comment. */
export function tokenize(line: string): { tokens: RawToken[]; commentStart: number } {
  const tokens: RawToken[] = [];
  let commentStart = -1;
  let i = 0;
  let expecting = true;
  const len = line.length;
  const blank = (c: string) => c === ' ' || c === '\t';
  while (i < len) {
    const c = line[i];
    if (blank(c)) { i++; continue; }
    if (c === '/') { commentStart = i; break; }
    if (c === ',') {
      if (expecting) tokens.push({ start: i, length: 0, quoted: false });
      expecting = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let end = line.indexOf(c, i + 1);
      if (end < 0) end = len - 1;
      tokens.push({ start: i, length: end - i + 1, quoted: true });
      i = end + 1;
    } else {
      let j = i;
      while (j < len && !(blank(line[j]) || line[j] === ',' || line[j] === '/')) j++;
      tokens.push({ start: i, length: j - i, quoted: false });
      i = j;
    }
    while (i < len && blank(line[i])) i++;
    if (i < len && line[i] === ',') i++;
    expecting = true;
  }
  return { tokens, commentStart };
}

export function tryInt(line: string, t: RawToken | undefined): number | undefined {
  if (!t || t.quoted || t.length === 0) return undefined;
  const s = tokText(line, t);
  if (!/^[+-]?\d+$/.test(s)) return undefined;
  const v = Number(s);
  return v >= -2147483648 && v <= 2147483647 ? v : undefined;
}

const KEYWORDS: [string, Section][] = [
  ['SYSTEM-WIDE', 'SystemWide'], ['SYSTEM WIDE', 'SystemWide'], ['SYSTEM SWITCHING', 'SwitchingDevice'], ['SUBSTATION', 'Substation'],
  ['IMPEDANCE CORRECTION', 'ImpedanceCorrection'], ['MULTI-SECTION', 'MultiSectionLine'], ['MULTI SECTION', 'MultiSectionLine'],
  ['MULTI-TERMINAL', 'MultiTerminalDc'], ['MULTI TERMINAL', 'MultiTerminalDc'], ['TWO-TERMINAL', 'TwoTerminalDc'],
  ['TWO TERMINAL', 'TwoTerminalDc'], ['VSC', 'VscDc'], ['VOLTAGE SOURCE', 'VscDc'], ['INTER-AREA', 'InterAreaTransfer'],
  ['INTERAREA', 'InterAreaTransfer'], ['BRANCH', 'Branch'], ['TRANSFORMER', 'Transformer'], ['FIXED SHUNT', 'FixedShunt'],
  ['SWITCHED SHUNT', 'SwitchedShunt'], ['INDUCTION', 'InductionMachine'], ['GENERATOR', 'Generator'], ['MACHINE', 'Generator'],
  ['LOAD', 'Load'], ['AREA', 'Area'], ['ZONE', 'Zone'], ['OWNER', 'Owner'], ['FACTS', 'Facts'], ['GNE', 'Gne'], ['BUS', 'Bus'],
];

function sectionFromLabel(label: string): Section | null {
  const upper = label.toUpperCase();
  const begin = upper.indexOf('BEGIN');
  if (begin < 0) return null;
  const name = upper.slice(begin + 5);
  for (const [k, s] of KEYWORDS) if (name.includes(k)) return s;
  return 'Unknown';
}

const ORDER_V33: Section[] = ['Bus', 'Load', 'FixedShunt', 'Generator', 'Branch', 'Transformer', 'Area', 'TwoTerminalDc', 'VscDc',
  'ImpedanceCorrection', 'MultiTerminalDc', 'MultiSectionLine', 'Zone', 'InterAreaTransfer', 'Owner', 'Facts', 'SwitchedShunt', 'Gne',
  'InductionMachine', 'End'];
const ORDER_V34: Section[] = ['SystemWide', 'Bus', 'Load', 'FixedShunt', 'Generator', 'Branch', 'SwitchingDevice', 'Transformer', 'Area',
  'TwoTerminalDc', 'VscDc', 'ImpedanceCorrection', 'MultiTerminalDc', 'MultiSectionLine', 'Zone', 'InterAreaTransfer', 'Owner', 'Facts',
  'SwitchedShunt', 'Gne', 'InductionMachine', 'Substation', 'End'];

function nextInOrder(version: number, current: Section): Section {
  const order = version >= 34 ? ORDER_V34 : ORDER_V33;
  const i = order.indexOf(current);
  return i < 0 || i + 1 >= order.length ? 'End' : order[i + 1];
}

const SYSTEM_WIDE = new Set(['GENERAL', 'GAUSS', 'NEWTON', 'ADJUST', 'TYSL', 'SOLVER', 'RATING']);

class RawWalker {
  version = 33;
  versionFromFile = false;
  sawLabels = false;
  sawUnlabeledTerminator = false;

  async *walk(lines: AsyncIterable<string>): AsyncGenerator<RawLine> {
    let phase = 0;
    let section: Section = 'Bus';
    let firstData = true;
    let remaining = 0;
    let recordLine = 0;
    let sub = 0;
    const mk = (p: Partial<RawLine> & { text: string; kind: LineKind; section: Section }): RawLine => ({
      recordLine: 0, subBlock: 0, tokens: [], commentStart: -1, titleIndex: 0, ...p,
    });

    for await (const text of lines) {
      if (phase === 4) { yield mk({ text, kind: 'Trailer', section: 'End' }); continue; }
      if (text.startsWith('@!') || (phase === 3 && netTrim(text).length === 0 && remaining === 0)) {
        yield mk({ text, kind: 'Passthrough', section });
        continue;
      }
      if (phase === 0) {
        const t = tokenize(text);
        const rev = tryInt(text, t.tokens[2]);
        if (t.tokens.length >= 3 && rev !== undefined && rev > 0) { this.version = rev; this.versionFromFile = true; }
        phase = 1;
        yield mk({ text, kind: 'CaseId', section: 'CaseId', tokens: t.tokens, commentStart: t.commentStart });
        continue;
      }
      if (phase === 1 || phase === 2) {
        yield mk({ text, kind: 'Title', section: 'CaseId', titleIndex: phase });
        phase++;
        continue;
      }
      const { tokens, commentStart: cs } = tokenize(text);
      if (remaining > 0) {
        remaining--;
        recordLine++;
        yield mk({ text, kind: 'Data', section, recordLine, subBlock: sub, tokens, commentStart: cs });
        continue;
      }
      if (firstData) {
        firstData = false;
        section = tokens.length > 0 && !tokens[0].quoted && SYSTEM_WIDE.has(tokText(text, tokens[0]).toUpperCase()) ? 'SystemWide' : 'Bus';
      }
      if (tokens.length === 1 && !tokens[0].quoted && (tokText(text, tokens[0]) === 'Q' || tokText(text, tokens[0]) === 'q')) {
        phase = 4;
        yield mk({ text, kind: 'End', section: 'End', tokens, commentStart: cs });
        continue;
      }
      if (tokens.length === 1 && !tokens[0].quoted && tokText(text, tokens[0]) === '0') {
        const label = cs < 0 ? '' : text.slice(cs + 1);
        yield mk({ text, kind: 'Terminator', section, subBlock: sub, tokens, commentStart: cs });
        if (section === 'Substation' && sub > 0) { sub = (sub + 1) % 4; continue; }
        const labeled = sectionFromLabel(label);
        if (labeled !== null && labeled !== 'Unknown') { this.sawLabels = true; section = labeled; }
        else {
          if (labeled === null) this.sawUnlabeledTerminator = true;
          section = nextInOrder(this.version, section);
        }
        sub = 0;
        continue;
      }
      const intAt = (i: number) => { const v = tryInt(text, tokens[i]); return v !== undefined && v > 0 ? v : 0; };
      let lines = 1;
      if (section === 'Transformer') { const k = tryInt(text, tokens[2]); lines = tokens.length > 2 && k !== undefined && k !== 0 ? 5 : 4; }
      else if (section === 'TwoTerminalDc' || section === 'VscDc') lines = 3;
      else if (section === 'MultiTerminalDc') lines = 1 + intAt(1) + intAt(2) + intAt(3);
      remaining = Math.max(0, lines - 1);
      recordLine = 0;
      const thisSub = sub;
      if (section === 'Substation' && sub === 0) sub = 1;
      yield mk({ text, kind: 'Data', section, recordLine: 0, subBlock: thisSub, tokens, commentStart: cs });
    }
  }
}

/** Field positions holding bus numbers (see docs/formats/psse.md). */
export function busFields(l: RawLine): number[] {
  const n = l.tokens.length;
  switch (l.section) {
    case 'Bus': case 'Load': case 'FixedShunt': case 'InductionMachine': return [0];
    case 'Generator': return [0, 7];
    case 'Branch': case 'SwitchingDevice': return [0, 1];
    case 'Transformer':
      if (l.recordLine === 0) return [0, 1, 2];
      if (l.recordLine >= 2 && n >= 15) return [n >= 25 ? 16 : 7];
      return [];
    case 'Area': return [1];
    case 'TwoTerminalDc': return l.recordLine >= 1 ? (n >= 18 ? [0, 12, 14, 15] : [0, 12, 13, 14]) : [];
    case 'VscDc': return l.recordLine >= 1 ? [0, 13] : [];
    case 'MultiSectionLine': { const f = [0, 1]; for (let i = 4; i < n; i++) f.push(i); return f; }
    case 'Facts': return [1, 2, 19];
    case 'SwitchedShunt': return [0, n > 1 && l.tokens[1].quoted ? 7 : 6];
    case 'Substation': return l.subBlock === 1 ? [2] : l.subBlock === 3 ? [0] : [];
    default: return [];
  }
}

function renumberBlocker(l: RawLine): string | null {
  if (l.section === 'MultiTerminalDc') return 'multi-terminal DC data';
  if (l.section === 'Gne') return 'GNE device data';
  if (l.section === 'Substation' && l.subBlock === 3 && l.tokens.length > 2 && ['B', '2', '3'].includes(netTrim(tokInner(l.text, l.tokens[2]))))
    return 'substation equipment terminals of branches/transformers';
  return null;
}

const HAS_LETTER = /\p{L}/u;
const RE_WORD = /[A-Za-z0-9][A-Za-z0-9_.&-]*/g;
const SECTION_LABEL = /^\s*END OF .*DATA/i;

interface FileInventory { names: Set<string>; version: number; danglingRefs: number }

class PsseJob implements FormatJob {
  private readonly ctx: JobContext;
  private readonly rules: GlobalRules;
  private readonly keep: RegExp[];
  private readonly names: [string, string][] = [];
  private readonly nameSeen = new Set<string>();
  private readonly buses: number[] = [];
  private readonly busSeen = new Set<number>();
  private readonly perFile = new Map<string, FileInventory>();
  private readonly blockers: string[] = [];
  private nameMap = new Map<string, string>();
  private busMap = new Map<number, number>();
  private readonly preserved = new Set<string>();
  private renumber = false;

  constructor(ctx: JobContext) {
    this.ctx = ctx;
    this.rules = new GlobalRules(ctx.profile);
    this.keep = ctx.profile.psse.keepStringPatterns.map((p) => new RegExp(p));
  }

  private isNameField(l: RawLine, index: number, inner: string): boolean {
    if (l.section === 'SystemWide' || l.section === 'CaseId') return false;
    if (l.section === 'Gne' && l.recordLine === 0 && index === 1) return false;
    if (l.section === 'Substation' && l.subBlock === 3 && index === 2) return false;
    if (netTrim(inner).length === 0) return false;
    return !this.keep.some((r) => r.test(inner));
  }

  private lines(source: ByteSource) {
    return readLines(decode(source, 'latin1'));
  }

  async scan(source: ByteSource): Promise<void> {
    const inv: FileInventory = { names: new Set(), version: 33, danglingRefs: 0 };
    const walker = new RawWalker();
    const refs: number[] = [];
    const buses = new Set<number>();
    for await (const l of walker.walk(this.lines(source))) {
      if (l.kind !== 'Data') continue;
      l.tokens.forEach((t, i) => {
        if (!t.quoted) return;
        const inner = tokInner(l.text, t);
        if (!this.isNameField(l, i, inner)) return;
        const key = netTrim(inner);
        inv.names.add(key);
        if (!this.nameSeen.has(key)) { this.nameSeen.add(key); this.names.push([key, sectionKey(l)]); }
      });
      const bus = l.section === 'Bus' ? tryInt(l.text, l.tokens[0]) : undefined;
      if (bus !== undefined) {
        buses.add(bus);
        if (!this.busSeen.has(bus)) { this.busSeen.add(bus); this.buses.push(bus); }
      } else {
        for (const f of busFields(l)) {
          const r = tryInt(l.text, l.tokens[f]);
          if (r !== undefined && r !== 0) refs.push(Math.abs(r));
        }
      }
      const why = renumberBlocker(l);
      if (why && !this.blockers.includes(why)) this.blockers.push(why);
    }
    inv.version = walker.version;
    inv.danglingRefs = refs.filter((b) => !buses.has(b)).length;
    this.perFile.set(source.name, inv);
    if (this.ctx.profile.psse.renumberBuses && !this.ctx.restore && !walker.sawLabels && walker.sawUnlabeledTerminator)
      this.blockers.push("unlabeled section terminators (expected '0 / END OF X DATA, BEGIN Y DATA')");
  }

  buildMaps(): void {
    const o = this.ctx.profile.psse;
    const pre = this.ctx.mapping?.psse;
    if (this.ctx.restore) {
      if (!pre) throw new Error('restore needs a mapping');
      for (const [k, v] of Object.entries(pre.names)) if (k !== v && !this.nameMap.has(v)) this.nameMap.set(v, k);
      for (const [k, v] of Object.entries(pre.buses)) { const orig = Number(k); if (Number.isInteger(orig) && !this.busMap.has(v)) this.busMap.set(v, orig); }
      this.renumber = this.busMap.size > 0;
      return;
    }
    if (pre) for (const [k, v] of Object.entries(pre.names)) this.nameMap.set(k, v);
    if (o.anonymizeNames) {
      const counter = new NameCounter(this.nameMap.values());
      for (const [name, section] of this.names) {
        if (this.nameMap.has(name)) continue;
        if (this.rules.isPreserved(name)) { this.nameMap.set(name, name); this.preserved.add(name); continue; }
        const prefix = o.namePrefixes[section] ?? o.namePrefixes.default ?? 'NAME';
        this.nameMap.set(name, counter.nextName(prefix));
      }
    }
    this.renumber = o.renumberBuses;
    if (this.renumber) {
      if (this.blockers.length > 0)
        throw new NotSupportedError(
          'Bus renumbering is not safe for this file: it contains ' + this.blockers.join('; ') +
            '. Run without --renumber-buses (names are still anonymized), or open an issue with a sample.',
        );
      if (pre) for (const [k, v] of Object.entries(pre.buses)) { const orig = Number(k); if (Number.isInteger(orig)) this.busMap.set(orig, v); }
      const used = new Set(this.busMap.values());
      let fresh = this.buses.filter((b) => !this.busMap.has(b));
      if (o.busNumberStrategy.toLowerCase() === 'shuffled') {
        const key = new Map(fresh.map((b) => [b, hexDigest(this.ctx.salt, 'bus ' + b, 16)]));
        fresh = [...fresh].sort((a, b) => (key.get(a)! < key.get(b)! ? -1 : key.get(a)! > key.get(b)! ? 1 : 0));
      }
      let next = Math.max(1, o.busNumberStart);
      for (const b of fresh) {
        while (used.has(next)) next++;
        if (next > 999_997) throw new Error('Ran out of bus numbers (PSS/E maximum is 999997)');
        this.busMap.set(b, next);
        used.add(next++);
      }
    }
  }

  async rewrite(source: ByteSource, out: OutputFile): Promise<FileReport> {
    const o = this.ctx.profile.psse;
    const report = newReport(source, 'psse');
    report.output = out.name;
    const walker = new RawWalker();
    const unmapped: number[] = [];
    const nl = await detectNewLine(source);
    try {
      for await (const l of walker.walk(this.lines(source))) {
        const line = this.rewriteLine(l, report, unmapped, walker, o, this.ctx.restore);
        if (line !== null) await out.sink.write(line + nl);
      }
    } catch (e) {
      await out.abort();
      throw e;
    }
    const written = await out.commit();
    if (!walker.versionFromFile) report.warnings.push('No revision number on the case identification line; assumed rev 33 layouts.');
    report.stats.revision = walker.version;
    if (unmapped.length > 0)
      report.warnings.push(`Bus references to buses not in this file were left unchanged, e.g. ${unmapped.join(', ')}.`);
    report.bytesOut = written.size;
    return report;
  }

  private rewriteLine(l: RawLine, report: FileReport, unmapped: number[], walker: RawWalker, o: PsseOptions, restore: boolean): string | null {
    switch (l.kind) {
      case 'Passthrough':
      case 'End':
        return l.text;
      case 'Trailer':
        if (restore || !o.stripComments) return l.text;
        count(report, 'trailerLinesDropped');
        return null;
      case 'Title':
        if (restore || !o.replaceCaseTitle) return restore ? l.text : this.rules.redactText(l.text, report);
        count(report, 'titles');
        return l.titleIndex === 1 ? o.caseTitle : '';
      case 'CaseId':
        if (restore || !o.stripComments || l.commentStart < 0) return l.text;
        count(report, 'comments');
        return netTrimEnd(l.text.slice(0, l.commentStart)) + `     / PSS(R)E-${walker.version} RAW (anonymized)`;
      case 'Terminator':
        if (restore || !o.stripComments || l.commentStart < 0) return l.text;
        if (SECTION_LABEL.test(comment(l))) return l.text;
        count(report, 'comments');
        return netTrimEnd(l.text.slice(0, l.commentStart));
    }

    const edits: { start: number; length: number; text: string }[] = [];
    const text = l.text;
    if (l.section !== 'SystemWide') {
      l.tokens.forEach((t, i) => {
        if (!t.quoted) return;
        const inner = tokInner(text, t);
        const key = netTrim(inner);
        let replacement: string | null = null;
        const mapped = this.nameMap.get(key);
        if ((restore || this.isNameField(l, i, inner)) && mapped !== undefined && mapped !== key) {
          replacement = mapped.length < inner.length ? mapped.padEnd(inner.length) : mapped;
          count(report, 'names');
        } else if (!restore && this.rules.hasRedactions) {
          const red = this.rules.redactText(inner, report);
          if (red !== inner) replacement = red;
        }
        if (replacement !== null) edits.push({ start: t.start + 1, length: t.length - 2, text: replacement });
      });
    }
    if (this.renumber) {
      for (const f of l.section === 'Bus' ? [0] : busFields(l)) {
        if (f >= l.tokens.length) continue;
        const t = l.tokens[f];
        const value = tryInt(text, t);
        if (value === undefined || value === 0) continue;
        const nb = this.busMap.get(Math.abs(value));
        if (nb !== undefined) {
          edits.push({ start: t.start, length: t.length, text: ((value < 0 ? '-' : '') + nb).padStart(t.length) });
          count(report, 'busNumbers');
        } else {
          count(report, 'unmappedBusRefs');
          if (unmapped.length < 5 && !unmapped.includes(value)) unmapped.push(value);
        }
      }
    }
    if (!restore && o.zeroCoordinates && l.section === 'Substation' && l.subBlock === 0 && l.recordLine === 0) {
      for (const f of [2, 3]) {
        const t = l.tokens[f];
        if (!t || t.quoted || t.length === 0) continue;
        edits.push({ start: t.start, length: t.length, text: '0.0000'.padStart(t.length) });
        count(report, 'coordinates');
      }
    }

    const body = l.commentStart >= 0 ? text.slice(0, l.commentStart) : text;
    let s = '';
    let pos = 0;
    for (const e of [...edits].sort((a, b) => a.start - b.start)) {
      s += body.slice(pos, e.start) + e.text;
      pos = e.start + e.length;
    }
    s += body.slice(pos);
    if (l.commentStart >= 0) {
      if (!restore && o.stripComments) { count(report, 'comments'); return netTrimEnd(s); }
      s += restore ? text.slice(l.commentStart) : this.rules.redactText(text.slice(l.commentStart), report);
    }
    return s;
  }

  async audit(original: ByteSource, output: ByteSource): Promise<AuditResult> {
    if (!this.perFile.has(original.name)) await this.scan(original);
    const inv = this.perFile.get(original.name)!;
    const hunted = new Set<string>(); // lower-cased: case-insensitive
    let excluded = 0;
    if (this.ctx.profile.psse.anonymizeNames) {
      for (const n of inv.names) {
        if (this.preserved.has(n)) { excluded++; continue; }
        if (n.length >= 3 && HAS_LETTER.test(n)) hunted.add(n.toLowerCase());
        for (const w of n.match(RE_WORD) ?? []) if (w.length >= 4 && HAS_LETTER.test(w)) hunted.add(w.toLowerCase());
      }
      for (const v of this.nameMap.values()) for (const w of v.match(RE_WORD) ?? []) hunted.delete(w.toLowerCase());
    }
    const leaked = new Map<string, string>();
    const terms = new Set<string>();
    const buses = new Set<number>();
    const refs: [number, string][] = [];
    const duplicates: number[] = [];
    const hunt = (value: string) => {
      if (hunted.size === 0) return;
      const v = netTrim(value);
      if (hunted.has(v.toLowerCase())) leaked.set(v.toLowerCase(), v);
      for (const w of v.match(RE_WORD) ?? []) if (hunted.has(w.toLowerCase())) leaked.set(w.toLowerCase(), w);
    };
    const walker = new RawWalker();
    for await (const l of walker.walk(this.lines(output))) {
      for (const t of this.rules.findTerms(l.text)) terms.add(t);
      if (l.kind === 'Title' || l.kind === 'Trailer') { hunt(l.text); continue; }
      if (l.commentStart >= 0 && l.kind !== 'Terminator') hunt(comment(l));
      if (l.kind !== 'Data') continue;
      for (const t of l.tokens) if (t.quoted && l.section !== 'SystemWide') hunt(tokInner(l.text, t));
      const b = l.section === 'Bus' ? tryInt(l.text, l.tokens[0]) : undefined;
      if (b !== undefined) {
        if (buses.has(b)) duplicates.push(b);
        buses.add(b);
      } else {
        for (const f of busFields(l)) {
          const r = tryInt(l.text, l.tokens[f]);
          if (r !== undefined && r !== 0) refs.push([Math.abs(r), sectionKey(l)]);
        }
      }
    }
    const integrity: string[] = [];
    const dangling = refs.filter(([bus]) => !buses.has(bus));
    if (dangling.length > inv.danglingRefs)
      integrity.push(...dangling.slice(0, 10).map(([bus, where]) => `${where} references bus ${bus}, which is not defined`));
    if (duplicates.length > 0) integrity.push(`duplicate bus numbers: ${duplicates.slice(0, 10).join(', ')}`);
    return auditResult({
      hunted: hunted.size + this.rules.redactTerms.length,
      vocabularyExcluded: excluded,
      leakedNames: [...leaked.values()].sort().slice(0, 20),
      leakedTerms: [...terms].sort(),
      integrityIssues: integrity,
    });
  }

  exportTo(mapping: MappingDocument): void {
    if (this.ctx.restore) return;
    mapping.psse.names = Object.fromEntries(new Map([...Object.entries(mapping.psse.names), ...this.nameMap]));
    mapping.psse.buses = Object.fromEntries(new Map([...Object.entries(mapping.psse.buses), ...[...this.busMap].map(([k, v]) => [String(k), v] as [string, number])]));
  }
}

export const psseHandler: FormatHandler = {
  id: 'psse',
  description: 'PSS/E power-flow RAW (rev 30-35): names, titles, comments, optional bus renumbering',
  extensions: ['.raw'],
  encoding: 'latin1',
  sniff(head) {
    const lines = head.split(/\r\n|\n|\r/);
    const line = lines.find((l) => !l.startsWith('@!'));
    if (line === undefined) return false;
    const { tokens } = tokenize(line);
    const ic = tryInt(line, tokens[0]);
    return tokens.length >= 2 && (ic === 0 || ic === 1) && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tokText(line, tokens[1])) &&
      head.toUpperCase().includes('END OF BUS DATA');
  },
  createJob: (ctx) => new PsseJob(ctx),
};
