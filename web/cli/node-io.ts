/** Node filesystem adapters for the engine's ByteSource / OutputTarget. */

import { createReadStream, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { encode, type ByteSource, type OutputFile, type OutputTarget, type TextEncoding } from '../src/core/shared.ts';

export function fileSource(path: string): ByteSource {
  const full = resolve(path);
  return {
    name: full,
    get size() { return statSync(full).size; },
    async *open() {
      for await (const chunk of createReadStream(full, { highWaterMark: 1 << 20 })) yield chunk as Uint8Array;
    },
  };
}

/** Writes via a temporary file and renames on commit, so a failed run never leaves a half-written model. */
export function dirTarget(dir: string): OutputTarget {
  return {
    async create(name: string, encoding: TextEncoding): Promise<OutputFile> {
      const finalPath = resolve(join(dir, basename(name)));
      await mkdir(dirname(finalPath), { recursive: true });
      const temp = join(dirname(finalPath), '.' + basename(finalPath) + '.partial');
      const fh = await open(temp, 'w');
      let buffer: string[] = [];
      let buffered = 0;
      let committed: ByteSource | undefined;
      const flush = async () => {
        if (buffered === 0) return;
        const bytes = encode(buffer.join(''), encoding);
        buffer = [];
        buffered = 0;
        await fh.write(bytes);
      };
      return {
        name: finalPath,
        sink: {
          async write(text: string) {
            buffer.push(text);
            buffered += text.length;
            if (buffered >= 1 << 20) await flush();
          },
        },
        async commit() {
          if (committed) return committed;
          await flush();
          await fh.close();
          await rename(temp, finalPath);
          committed = fileSource(finalPath);
          return committed;
        },
        async abort() {
          await fh.close().catch(() => {});
          await rm(temp, { force: true });
        },
      };
    },
  };
}
