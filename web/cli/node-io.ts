/** Node filesystem adapters for the engine's ByteSource / OutputTarget. */

import { createReadStream, statSync } from 'node:fs';
import { copyFile, mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { encode, type ByteSource, type OutputFile, type OutputTarget, type TextEncoding } from '../src/core/shared.ts';
import { ZipWriter, type RandomAccess } from '../src/core/zip.ts';

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
      // Engine names are a file name or a relative path (a zip's layout). Never let one escape `dir`.
      const finalPath = isAbsolute(name) ? resolve(join(dir, basename(name))) : resolve(join(dir, name));
      const rel = relative(resolve(dir), finalPath);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Refusing to write outside the output folder: ${name}`);
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

/** Random access to a file on disk, for reading zips. Call close() when done. */
export async function fileAccess(path: string): Promise<RandomAccess & { close(): Promise<void> }> {
  const fh = await open(path, 'r');
  const size = (await fh.stat()).size;
  return {
    size,
    async read(offset: number, length: number) {
      const buf = Buffer.alloc(length);
      let got = 0;
      while (got < length) {
        const { bytesRead } = await fh.read(buf, got, length - got, offset + got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, got);
    },
    close: () => fh.close(),
  };
}

/** Write files into a new zip (via a .partial file, like the .NET edition). */
export async function writeZip(zipPath: string, files: { entryName: string; filePath: string }[]): Promise<void> {
  const full = resolve(zipPath);
  await mkdir(dirname(full), { recursive: true });
  const temp = full + '.partial';
  const fh = await open(temp, 'w');
  try {
    const w = new ZipWriter(async (b) => { await fh.write(b); });
    for (const f of files) await w.add(f.entryName, fileSource(f.filePath).open());
    await w.finish();
    await fh.close();
    await rename(temp, full);
  } catch (e) {
    await fh.close().catch(() => {});
    await rm(temp, { force: true });
    throw e;
  }
}

/** rename, falling back to copy + delete across drives (the temp folder may be elsewhere). */
export async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}
