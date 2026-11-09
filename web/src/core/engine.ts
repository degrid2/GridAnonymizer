/**
 * Orchestrates a run (twin of AnonymizerEngine.cs): groups inputs by format,
 * scans every file of a group before rewriting any, audits each output, and
 * runs plain-text files last so they reuse the names just mapped.
 */

import { cimHandler } from './cim.ts';
import { newSalt } from './hash.ts';
import { emptyMapping, type MappingDocument } from './mapping.ts';
import { defaultProfile, type Profile } from './profile.ts';
import { psseAuxHandler } from './psse-aux.ts';
import { psseHandler } from './psse.ts';
import { readHead, type AuditResult, type ByteSource, type FormatHandler, type OutputTarget, type RunReport } from './shared.ts';
import { textHandler } from './text.ts';

import { VERSION } from './version.ts';

export { VERSION };
export const TOOL = `gridanon-web ${VERSION}`;

export const formats: readonly FormatHandler[] = [cimHandler, psseHandler, psseAuxHandler, textHandler];

export function getFormat(id: string): FormatHandler {
  const f = formats.find((h) => h.id === id.toLowerCase());
  if (!f) throw new Error(`Unknown format '${id}'. Known: ${formats.map((h) => h.id).join(', ')}`);
  return f;
}

/** Sniff content first, then fall back to the extension. */
export async function detectFormat(source: ByteSource): Promise<FormatHandler | undefined> {
  const head = await readHead(source);
  for (const h of formats) if (h.sniff(head)) return h;
  const dot = source.name.lastIndexOf('.');
  const ext = dot >= 0 ? source.name.slice(dot).toLowerCase() : '';
  return formats.find((h) => h.extensions.includes(ext));
}

export interface InputFile {
  source: ByteSource;
  format: FormatHandler;
  /** Folder of the output, relative to the target ('' or undefined: the top). Keeps a zip's layout. */
  relativeDirectory?: string;
}

export interface EngineOptions {
  profile?: Profile;
  salt?: string;
  mapping?: MappingDocument;
  audit?: boolean;
  outputSuffix?: string;
  log?: (message: string) => void;
  progress?: (stage: string, file: string, index: number, total: number) => void;
}

export interface RunResult {
  report: RunReport;
  mapping: MappingDocument;
  salt: string;
  saltWasGenerated: boolean;
  outputs: ByteSource[];
}

export function outputName(input: string, suffix: string): string {
  const base = input.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) + suffix + base.slice(dot) : base + suffix;
}

export async function anonymize(inputs: InputFile[], target: OutputTarget, opts: EngineOptions = {}): Promise<RunResult> {
  return run(inputs, target, opts, false);
}

export async function restore(inputs: InputFile[], target: OutputTarget, opts: EngineOptions): Promise<RunResult> {
  return run(inputs, target, opts, true);
}

async function run(inputs: InputFile[], target: OutputTarget, opts: EngineOptions, isRestore: boolean): Promise<RunResult> {
  const profile = opts.profile ?? defaultProfile();
  if (isRestore && !opts.mapping) throw new Error('restore requires a mapping file');
  if (opts.mapping && opts.salt !== undefined && opts.mapping.salt.length > 0 && opts.mapping.salt !== opts.salt)
    throw new Error('--salt differs from the salt stored in the mapping file; pass only one of them.');
  const generated = opts.salt === undefined && opts.mapping === undefined;
  const salt = opts.salt ?? opts.mapping?.salt ?? newSalt();

  const mapping = emptyMapping();
  mapping.tool = TOOL;
  mapping.salt = salt;
  mapping.profile = profile.name;
  mapping.sources = [...new Set([...(opts.mapping?.sources ?? []), ...inputs.map((i) => i.source.name.replace(/^.*[\\/]/, ''))])];
  if (opts.mapping) {
    const m = opts.mapping;
    mapping.cim = { ids: { ...m.cim.ids }, names: { ...m.cim.names }, mrids: { ...m.cim.mrids }, descriptions: { ...m.cim.descriptions }, preserved: [...m.cim.preserved] };
    mapping.psse = { names: { ...m.psse.names }, buses: { ...m.psse.buses } };
  }

  const report: RunReport = { tool: TOOL, mode: isRestore ? 'restore' : 'anonymize', started: new Date().toISOString(), profile: profile.name, files: [], clean: true };
  const suffix = isRestore ? '_restored' : opts.outputSuffix ?? '_anonymized';
  const outputs: ByteSource[] = [];

  const groups = new Map<string, InputFile[]>();
  for (const i of inputs) {
    if (!groups.has(i.format.id)) groups.set(i.format.id, []);
    groups.get(i.format.id)!.push(i);
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[1][0].format.phase ?? 0) - (b[1][0].format.phase ?? 0));
  let done = 0;

  for (const [id, files] of ordered) {
    const handler = files[0].format;
    const job = handler.createJob({
      profile,
      salt,
      restore: isRestore,
      mapping: (handler.phase ?? 0) > 0 || isRestore ? mapping : opts.mapping,
    });
    for (const f of files) {
      opts.log?.(`scan     ${f.source.name} [${id}]`);
      opts.progress?.('scanning', f.source.name, done, inputs.length);
      await job.scan(f.source);
    }
    job.buildMaps();
    for (const f of files) {
      const rel = (f.relativeDirectory ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const name = rel ? `${rel}/${outputName(f.source.name, suffix)}` : outputName(f.source.name, suffix);
      opts.log?.(`${isRestore ? 'restore ' : 'rewrite '} ${f.source.name} -> ${name}`);
      opts.progress?.(isRestore ? 'restoring' : 'rewriting', f.source.name, done, inputs.length);
      const out = await target.create(name, handler.encoding);
      const fr = await job.rewrite(f.source, out);
      const written = await out.commit();
      outputs.push(written);
      if ((opts.audit ?? true) && !isRestore) {
        opts.log?.(`audit    ${name}`);
        opts.progress?.('auditing', f.source.name, done, inputs.length);
        fr.audit = await job.audit(f.source, written);
      }
      report.files.push(fr);
      done++;
    }
    job.exportTo(mapping);
  }
  report.clean = report.files.every((f) => f.audit?.clean ?? true);
  return { report, mapping, salt, saltWasGenerated: generated, outputs };
}

/** Audit an anonymized file against its original without rewriting anything. */
export async function auditPair(original: ByteSource, anonymized: ByteSource, format: FormatHandler, opts: EngineOptions = {}): Promise<AuditResult> {
  const job = format.createJob({ profile: opts.profile ?? defaultProfile(), salt: opts.salt ?? opts.mapping?.salt ?? '', mapping: opts.mapping, restore: false });
  await job.scan(original);
  job.buildMaps();
  return job.audit(original, anonymized);
}
