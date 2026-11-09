import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after } from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirTarget, fileSource } from '../cli/node-io.ts';
import { anonymize, detectFormat, restore, type EngineOptions, type RunResult } from '../src/core/engine.ts';

export const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
export const sample = (rel: string) => join(repo, 'samples', rel);
export const golden = (name: string) => join(repo, 'test', 'golden', name);

const created: string[] = [];
after(() => { for (const d of created) rmSync(d, { recursive: true, force: true }); });

export function tempDir(): { path: string; file(name: string): string; write(name: string, text: string): string } {
  const path = mkdtempSync(join(tmpdir(), 'gridanon-ts-'));
  created.push(path);
  return {
    path,
    file: (n) => join(path, n),
    write(n, text) {
      const p = join(path, n);
      writeFileSync(p, text);
      return p;
    },
  };
}

async function inputs(files: string[]) {
  return Promise.all(files.map(async (f) => {
    const source = fileSource(f);
    const format = await detectFormat(source);
    if (!format) throw new Error('undetected ' + f);
    return { source, format };
  }));
}

export async function runAnon(outDir: string, files: string[], opts: EngineOptions = {}): Promise<RunResult> {
  return anonymize(await inputs(files), dirTarget(outDir), { salt: 'test-salt-123', ...opts });
}

export async function runRestore(outDir: string, files: string[], opts: EngineOptions): Promise<RunResult> {
  return restore(await inputs(files), dirTarget(outDir), opts);
}

export const out = (dir: string, input: string, suffix = '_anonymized') => {
  const base = input.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  return join(dir, base.slice(0, dot) + suffix + base.slice(dot));
};

export const read = (p: string) => readFileSync(p, 'utf8');
