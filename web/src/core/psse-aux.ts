/**
 * PSS/E companion files: .con (contingencies), .mon (monitored elements), .sub
 * (subsystems), .aux. Twin of the .NET PsseAuxHandler: same rules, same output.
 *
 *   BUS 101            a bus number, renumbered with the case
 *   BUSES 100 TO 200   a range, expanded into one BUS line per renumbered bus
 *   BUS 'NAME   345'   an extended bus name
 *   'any other text'   a label (contingency, subsystem...) → CTG_0001, SUBSYS_0001...
 *   COM ...            a comment line
 */

import { emptyMapping, type MappingDocument } from './mapping.ts';
import { tokenize, tokInner, tryInt, type RawToken } from './psse.ts';
import {
  auditResult, count, decode, detectNewLine, GlobalRules, NameCounter, netTrim, netTrimEnd, newReport, readLines,
  type AuditResult, type ByteSource, type FileReport, type FormatHandler, type FormatJob, type JobContext, type OutputFile,
} from './shared.ts';

interface AuxLine { text: string; tokens: RawToken[]; commentStart: number; isCom: boolean }

const LABEL_PREFIXES: Record<string, string> = {
  CONTINGENCY: 'CTG', SUBSYSTEM: 'SUBSYS', SUBSYS: 'SUBSYS', INTERFACE: 'INTF', JOIN: 'JOIN', TIE: 'TIE', GROUP: 'GROUP',
};

const HAS_LETTER = /\p{L}/u;
const RE_WORD = /[A-Za-z0-9][A-Za-z0-9_.&-]*/g;
/** Like .NET's StringComparer.OrdinalIgnoreCase once both sides are upper-cased. */
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const EXTENDED_BUS_NAME = /^(.*?)(\s+[\d.]+)$/;

async function* auxLines(source: ByteSource): AsyncGenerator<AuxLine> {
  for await (const text of readLines(decode(source, 'latin1'))) {
    const { tokens, commentStart } = tokenize(text);
    const isCom = tokens.length > 0 && !tokens[0].quoted && text.substr(tokens[0].start, tokens[0].length).toUpperCase() === 'COM';
    yield { text, tokens, commentStart, isCom };
  }
}

const upper = (l: AuxLine, i: number) => (l.tokens[i].quoted ? '' : l.text.substr(l.tokens[i].start, l.tokens[i].length).toUpperCase());

function prefixFor(l: AuxLine, i: number): string {
  for (let j = i - 1; j >= 0; j--) {
    if (l.tokens[j].quoted) continue;
    const p = LABEL_PREFIXES[upper(l, j)];
    if (p !== undefined) return p;
  }
  return 'LABEL';
}

function busRange(l: AuxLine, i: number): { lo: number; hi: number } | null {
  if (upper(l, i) !== 'BUSES' || i + 2 >= l.tokens.length) return null;
  const lo = tryInt(l.text, l.tokens[i + 1]);
  if (lo === undefined) return null;
  let j = i + 2;
  if (j < l.tokens.length && upper(l, j) === 'TO') j++;
  if (j >= l.tokens.length) return null;
  const hi = tryInt(l.text, l.tokens[j]);
  return hi === undefined ? null : { lo, hi };
}

class PsseAuxJob implements FormatJob {
  private readonly ctx: JobContext;
  private readonly rules: GlobalRules;
  private readonly keep: RegExp[];
  private readonly labels: [string, string][] = [];
  private readonly labelSeen = new Set<string>();
  private readonly names = new Map<string, string>();
  private readonly buses = new Map<number, number>();
  private readonly originalBuses: number[] = [];
  private readonly newLabels = new Map<string, string>();

  constructor(ctx: JobContext) {
    this.ctx = ctx;
    this.rules = new GlobalRules(ctx.profile);
    this.keep = ctx.profile.psse.keepStringPatterns.map((p) => new RegExp(p));
  }

  private isKept(inner: string): boolean {
    return netTrim(inner).length === 0 || this.keep.some((r) => r.test(inner));
  }

  async scan(source: ByteSource): Promise<void> {
    for await (const l of auxLines(source)) {
      if (l.isCom) continue;
      l.tokens.forEach((t, i) => {
        if (!t.quoted) return;
        const inner = tokInner(l.text, t);
        const key = netTrim(inner);
        const afterBus = i > 0 && upper(l, i - 1) === 'BUS';
        if (afterBus || this.isKept(inner)) return;
        if (!this.labelSeen.has(key)) { this.labelSeen.add(key); this.labels.push([key, prefixFor(l, i)]); }
      });
    }
  }

  buildMaps(): void {
    const m = this.ctx.mapping ?? emptyMapping();
    if (this.ctx.restore) {
      for (const [k, v] of Object.entries(m.psse.names)) if (k !== v && !this.names.has(v)) this.names.set(v, k);
      for (const [k, v] of Object.entries(m.psse.buses)) { const o = Number(k); if (Number.isInteger(o) && !this.buses.has(v)) this.buses.set(v, o); }
      return;
    }
    for (const [k, v] of Object.entries(m.psse.names)) this.names.set(k, v);
    for (const [k, v] of Object.entries(m.psse.buses)) { const o = Number(k); if (Number.isInteger(o)) { this.buses.set(o, v); this.originalBuses.push(o); } }
    if (this.ctx.profile.psse.anonymizeNames) {
      const counter = new NameCounter(this.names.values());
      for (const [label, prefix] of this.labels) {
        if (this.names.has(label)) continue;
        if (this.rules.isPreserved(label)) { this.names.set(label, label); continue; }
        const pseudonym = counter.nextName(prefix);
        this.names.set(label, pseudonym);
        this.newLabels.set(label, pseudonym);
      }
    }
  }

  private mapName(inner: string, afterBus: boolean): string | null {
    const key = netTrim(inner);
    if (!this.ctx.restore && !afterBus && this.isKept(inner)) return null;
    const mapped = this.names.get(key);
    if (mapped !== undefined && mapped !== key) return mapped.length < inner.length ? mapped.padEnd(inner.length) : mapped;
    const m = afterBus ? EXTENDED_BUS_NAME.exec(key) : null;
    const busName = m ? this.names.get(netTrim(m[1])) : undefined;
    if (m && busName !== undefined) {
      const rebuilt = busName.padEnd(Math.max(busName.length, m[1].length)) + m[2];
      return rebuilt.length < inner.length ? rebuilt.padEnd(inner.length) : rebuilt;
    }
    return null;
  }

  async rewrite(source: ByteSource, out: OutputFile): Promise<FileReport> {
    const report = newReport(source, 'psse-aux');
    report.output = out.name;
    const restore = this.ctx.restore;
    const o = this.ctx.profile.psse;
    const renumber = this.buses.size > 0;
    const missing: number[] = [];
    const nl = await detectNewLine(source);
    const write = (line: string) => out.sink.write(line + nl);

    try {
      for await (const l of auxLines(source)) {
        if (l.isCom) {
          if (!restore && o.stripComments) { count(report, 'comments'); continue; }
          await write(restore ? l.text : this.rules.redactText(l.text, report));
          continue;
        }

        if (renumber && !restore) {
          let range = -1;
          for (let i = 0; i < l.tokens.length; i++) if (busRange(l, i)) { range = i; break; }
          if (range >= 0) {
            const { lo, hi } = busRange(l, range)!;
            const indent = l.text.slice(0, l.tokens[range].start);
            const inRange = this.originalBuses.filter((b) => b >= lo && b <= hi).map((b) => this.buses.get(b)!).sort((a, b) => a - b);
            for (const nb of inRange) await write(`${indent}BUS ${nb}`);
            count(report, 'rangesExpanded');
            count(report, 'busNumbers', inRange.length);
            continue;
          }
        }

        const edits: { start: number; length: number; text: string }[] = [];
        l.tokens.forEach((t, i) => {
          const afterBus = i > 0 && upper(l, i - 1) === 'BUS';
          if (t.quoted) {
            const inner = tokInner(l.text, t);
            const replacement = this.mapName(inner, afterBus);
            if (replacement !== null && replacement !== inner) {
              edits.push({ start: t.start + 1, length: t.length - 2, text: replacement });
              count(report, afterBus ? 'names' : 'labels');
            } else if (!restore && this.rules.hasRedactions) {
              const red = this.rules.redactText(inner, report);
              if (red !== inner) edits.push({ start: t.start + 1, length: t.length - 2, text: red });
            }
            return;
          }
          const bus = afterBus && renumber ? tryInt(l.text, t) : undefined;
          if (bus === undefined || bus === 0) return;
          const nb = this.buses.get(Math.abs(bus));
          if (nb !== undefined) {
            edits.push({ start: t.start, length: t.length, text: ((bus < 0 ? '-' : '') + nb).padStart(t.length) });
            count(report, 'busNumbers');
          } else {
            count(report, 'unmappedBusRefs');
            if (missing.length < 5 && !missing.includes(bus)) missing.push(bus);
          }
        });

        const body = l.commentStart >= 0 ? l.text.slice(0, l.commentStart) : l.text;
        let s = '';
        let pos = 0;
        for (const e of [...edits].sort((a, b) => a.start - b.start)) {
          s += body.slice(pos, e.start) + e.text;
          pos = e.start + e.length;
        }
        s += body.slice(pos);
        if (l.commentStart >= 0) {
          if (!restore && o.stripComments) { count(report, 'comments'); await write(netTrimEnd(s)); continue; }
          s += restore ? l.text.slice(l.commentStart) : this.rules.redactText(l.text.slice(l.commentStart), report);
        }
        await write(s);
      }
    } catch (e) {
      await out.abort();
      throw e;
    }

    if (missing.length > 0)
      report.warnings.push(`Buses not in the case were left unchanged, e.g. ${missing.join(', ')}. Anonymize the .raw file in the same run.`);
    if (!restore && o.renumberBuses && !renumber)
      report.warnings.push('Bus renumbering is on, but no PSS/E case was renumbered in this run, so bus numbers here were kept. Add the .raw file to the same run.');
    report.bytesOut = (await out.commit()).size;
    return report;
  }

  private async dangling(source: ByteSource, known: Set<number>): Promise<number> {
    let n = 0;
    for await (const l of auxLines(source)) {
      if (l.isCom) continue;
      for (let i = 1; i < l.tokens.length; i++) {
        if (upper(l, i - 1) !== 'BUS') continue;
        const b = tryInt(l.text, l.tokens[i]);
        if (b !== undefined && b !== 0 && !known.has(Math.abs(b))) n++;
      }
    }
    return n;
  }

  async audit(original: ByteSource, output: ByteSource): Promise<AuditResult> {
    const hunted = new Set<string>(); // lower-cased: case-insensitive
    if (this.ctx.profile.psse.anonymizeNames) {
      const add = (n: string) => {
        if (n.length >= 3 && HAS_LETTER.test(n)) hunted.add(n.toLowerCase());
        for (const w of n.match(RE_WORD) ?? []) if (w.length >= 4 && HAS_LETTER.test(w)) hunted.add(w.toLowerCase());
      };
      for (const [k, v] of this.names) if (k !== v) add(k);
      for (const v of this.names.values()) for (const w of v.match(RE_WORD) ?? []) hunted.delete(w.toLowerCase());
    }
    const leaked = new Map<string, string>();
    const terms = new Set<string>();
    const hunt = (value: string) => {
      if (hunted.size === 0) return;
      const v = netTrim(value);
      const add = (x: string) => { if (hunted.has(x.toLowerCase()) && !leaked.has(x.toUpperCase())) leaked.set(x.toUpperCase(), x); };
      add(v);
      for (const w of v.match(RE_WORD) ?? []) add(w);
    };
    for await (const l of auxLines(output)) {
      for (const t of this.rules.findTerms(l.text)) terms.add(t);
      if (l.isCom) { hunt(l.text.slice(3)); continue; }
      for (const t of l.tokens) if (t.quoted) hunt(tokInner(l.text, t));
      if (l.commentStart >= 0) hunt(l.text.slice(l.commentStart + 1));
    }
    const integrity: string[] = [];
    if (this.buses.size > 0) {
      const before = await this.dangling(original, new Set(this.buses.keys()));
      const after = await this.dangling(output, new Set(this.buses.values()));
      if (after > before) integrity.push(`${after - before} bus reference(s) point to buses that are not in the case`);
    }
    return auditResult({
      hunted: hunted.size + this.rules.redactTerms.length,
      leakedNames: [...leaked.entries()].sort((a, b) => ordinal(a[0], b[0])).map((e) => e[1]).slice(0, 20),
      leakedTerms: [...new Map([...terms].map((t) => [t.toUpperCase(), t] as const)).entries()].sort((a, b) => ordinal(a[0], b[0])).map((e) => e[1]),
      integrityIssues: integrity,
    });
  }

  exportTo(mapping: MappingDocument): void {
    if (this.ctx.restore) return;
    mapping.psse.names = Object.fromEntries(new Map([...Object.entries(mapping.psse.names), ...this.newLabels]));
  }
}

export const psseAuxHandler: FormatHandler = {
  id: 'psse-aux',
  description: 'PSS/E contingency, monitored element, subsystem and auxiliary files (.con .mon .sub .aux), following the case in the same run',
  extensions: ['.con', '.mon', '.sub', '.aux'],
  encoding: 'latin1',
  phase: 1,
  sniff: () => false,
  createJob: (ctx) => new PsseAuxJob(ctx),
};
