/**
 * Runs the whole job off the main thread. Nothing here (or in anything it
 * imports) performs network I/O; the page's CSP (`connect-src 'none'`) makes
 * that a browser-enforced guarantee rather than a promise.
 */

import { anonymize, detectFormat, getFormat, restore, type InputFile } from '../core/engine.ts';
import { mappingToJson, parseMapping } from '../core/mapping.ts';
import { loadProfile } from '../core/profile.ts';
import type { FileReport } from '../core/shared.ts';
import { blobSource, DirectoryTarget, MemoryTarget, type ProducedFile } from './browser-io.ts';

export interface RunRequest {
  type: 'run';
  mode: 'anonymize' | 'restore';
  files: File[];
  /** per file: a format id, or null to detect */
  formats: (string | null)[];
  profileJson: string;
  overrides: { renumberBuses: boolean; keepComments: boolean; keepTitles: boolean; keepTypeHints: boolean; redactTerms: string[] };
  salt?: string;
  mappingJson?: string;
  directory?: FileSystemDirectoryHandle;
}

export interface DetectRequest {
  type: 'detect';
  files: File[];
}

export type WorkerOut =
  | { type: 'detected'; formats: (string | null)[] }
  | { type: 'progress'; stage: string; file: string; index: number; total: number }
  | { type: 'file-done'; report: FileReport; file?: ProducedFile }
  | { type: 'done'; salt: string; saltWasGenerated: boolean; mapping: string; clean: boolean; savedToFolder: boolean }
  | { type: 'error'; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<RunRequest | DetectRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'detect') {
      const out: (string | null)[] = [];
      for (const f of req.files) out.push((await detectFormat(blobSource(f, f.name)))?.id ?? null);
      post({ type: 'detected', formats: out });
      return;
    }

    const profile = loadProfile(req.profileJson);
    const o = req.overrides;
    if (o.renumberBuses) profile.psse.renumberBuses = true;
    if (o.keepComments) { profile.cim.stripComments = false; profile.psse.stripComments = false; }
    if (o.keepTitles) profile.psse.replaceCaseTitle = false;
    if (o.keepTypeHints) profile.cim.keepTypeHints = true;
    profile.redactTerms = [...profile.redactTerms, ...o.redactTerms];

    const inputs: InputFile[] = [];
    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i];
      const source = blobSource(f, f.name);
      const id = req.formats[i];
      const format = id ? getFormat(id) : await detectFormat(source);
      if (format) inputs.push({ source, format });
    }
    if (inputs.length === 0) throw new Error('None of these files is in a recognized format.');

    const mapping = req.mappingJson ? parseMapping(req.mappingJson) : undefined;
    const target = req.directory ? new DirectoryTarget(req.directory) : new MemoryTarget();
    const opts = {
      profile,
      salt: req.salt,
      mapping,
      progress: (stage: string, file: string, index: number, total: number) => post({ type: 'progress', stage, file, index, total }),
    };
    const result = req.mode === 'restore' ? await restore(inputs, target, opts) : await anonymize(inputs, target, opts);

    result.report.files.forEach((report, i) => post({ type: 'file-done', report, file: target.produced[i] }));
    post({
      type: 'done',
      salt: result.salt,
      saltWasGenerated: result.saltWasGenerated,
      mapping: mappingToJson(result.mapping),
      clean: result.report.clean,
      savedToFolder: !!req.directory,
    });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
