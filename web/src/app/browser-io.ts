/** Browser adapters: File → ByteSource, and two OutputTargets (in-memory Blob, or a folder via the File System Access API). */

import { encode, type ByteSource, type OutputFile, type OutputTarget, type TextEncoding } from '../core/shared.ts';

export function blobSource(blob: Blob, name: string): ByteSource {
  return {
    name,
    size: blob.size,
    async *open() {
      const reader = blob.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    },
  };
}

export interface ProducedFile {
  name: string;
  blob?: Blob;
  /** .NET edition: where the local server offers the file for download. */
  url?: string;
}

/** Collects each output as a Blob. Works in every browser; bounded by memory. */
export class MemoryTarget implements OutputTarget {
  readonly produced: ProducedFile[] = [];

  async create(name: string, encoding: TextEncoding): Promise<OutputFile> {
    const parts: BlobPart[] = [];
    let pending: string[] = [];
    let pendingLen = 0;
    let committed: ByteSource | undefined;
    const flush = () => {
      if (pendingLen === 0) return;
      parts.push(encode(pending.join(''), encoding) as Uint8Array<ArrayBuffer>);
      pending = [];
      pendingLen = 0;
    };
    return {
      name,
      sink: {
        write(text: string) {
          pending.push(text);
          pendingLen += text.length;
          if (pendingLen >= 1 << 20) flush();
        },
      },
      commit: async () => {
        if (committed) return committed;
        flush();
        const blob = new Blob(parts, { type: 'application/octet-stream' });
        this.produced.push({ name, blob });
        committed = blobSource(blob, name);
        return committed;
      },
      async abort() {
        parts.length = 0;
      },
    };
  }
}

/** Streams each output straight into a folder the user picked (Chrome/Edge). No memory ceiling. */
export class DirectoryTarget implements OutputTarget {
  readonly produced: ProducedFile[] = [];
  private readonly dir: FileSystemDirectoryHandle;

  constructor(dir: FileSystemDirectoryHandle) {
    this.dir = dir;
  }

  async create(name: string, encoding: TextEncoding): Promise<OutputFile> {
    // A relative path (a zip's layout) becomes sub-folders; '..' and empty parts are dropped.
    const parts = name.split('/').filter((p) => p && p !== '.' && p !== '..');
    let dir = this.dir;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
    const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await handle.createWritable();
    let pending: string[] = [];
    let pendingLen = 0;
    let committed: ByteSource | undefined;
    const flush = async () => {
      if (pendingLen === 0) return;
      const bytes = encode(pending.join(''), encoding);
      pending = [];
      pendingLen = 0;
      await writable.write(bytes as Uint8Array<ArrayBuffer>);
    };
    return {
      name,
      sink: {
        async write(text: string) {
          pending.push(text);
          pendingLen += text.length;
          if (pendingLen >= 1 << 20) await flush();
        },
      },
      commit: async () => {
        if (committed) return committed;
        await flush();
        await writable.close();
        this.produced.push({ name });
        committed = blobSource(await handle.getFile(), name);
        return committed;
      },
      async abort() {
        await writable.abort().catch(() => {});
      },
    };
  }
}
