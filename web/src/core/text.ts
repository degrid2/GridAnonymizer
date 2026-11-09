/**
 * Any text file (CSV results, contingency lists, reports) rewritten with the
 * names and ids mapped by the model files of the same run. Twin of TextHandler.cs.
 */

import { allTextPairs, emptyMapping, type MappingDocument } from './mapping.ts';
import {
  auditResult, count, decode, detectNewLine, escapeRe, GlobalRules, netTrim, newReport, readLines,
  type AuditResult, type ByteSource, type FileReport, type FormatHandler, type FormatJob, type JobContext, type OutputFile,
} from './shared.ts';

const DIGITS_ONLY = /^\p{Nd}*$/u;

class TextJob implements FormatJob {
  private readonly ctx: JobContext;
  private readonly rules: GlobalRules;
  private readonly pairs = new Map<string, string>();
  private regex?: RegExp;

  constructor(ctx: JobContext) {
    this.ctx = ctx;
    this.rules = new GlobalRules(ctx.profile);
  }

  async scan(): Promise<void> {}

  buildMaps(): void {
    const mapping = this.ctx.mapping ?? emptyMapping();
    const min = this.ctx.profile.text.minNameLength;
    for (const [k, v] of allTextPairs(mapping)) {
      let [from, to] = this.ctx.restore ? [v, k] : [k, v];
      from = netTrim(from);
      if (from.length < min || from === netTrim(to) || DIGITS_ONLY.test(from)) continue;
      if (!this.pairs.has(from)) this.pairs.set(from, netTrim(to));
    }
    if (this.pairs.size === 0) return;
    const keys = [...this.pairs.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    this.regex = new RegExp(`(?<![A-Za-z0-9_])(?:${keys.map(escapeRe).join('|')})(?![A-Za-z0-9_])`, 'g');
  }

  async rewrite(source: ByteSource, out: OutputFile): Promise<FileReport> {
    const report = newReport(source, 'text');
    report.output = out.name;
    if (!this.regex) report.warnings.push('No mapping available; file copied unchanged apart from redact terms.');
    const nl = await detectNewLine(source);
    try {
      for await (let line of readLines(decode(source, 'utf8'))) {
        if (this.regex) line = line.replace(this.regex, (m) => { count(report, 'replacements'); return this.pairs.get(m)!; });
        if (!this.ctx.restore) line = this.rules.redactText(line, report);
        await out.sink.write(line + nl);
      }
    } catch (e) {
      await out.abort();
      throw e;
    }
    report.bytesOut = (await out.commit()).size;
    return report;
  }

  async audit(_original: ByteSource, output: ByteSource): Promise<AuditResult> {
    const leaked = new Set<string>();
    const terms = new Set<string>();
    for await (const line of readLines(decode(output, 'utf8'))) {
      if (this.regex) for (const m of line.matchAll(this.regex)) if (leaked.size < 20) leaked.add(m[0]);
      for (const t of this.rules.findTerms(line)) terms.add(t);
    }
    return auditResult({ hunted: this.pairs.size + this.rules.redactTerms.length, leakedNames: [...leaked].sort(), leakedTerms: [...terms] });
  }

  exportTo(_m: MappingDocument): void {}
}

export const textHandler: FormatHandler = {
  id: 'text',
  description: "Any text file: applies the run's name/id mapping (whole-word, longest match first)",
  extensions: ['.csv', '.txt', '.con', '.mon', '.sub', '.log', '.json', '.py', '.idv'],
  encoding: 'utf8',
  sniff: () => false,
  createJob: (ctx) => new TextJob(ctx),
};
