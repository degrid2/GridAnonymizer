/**
 * Zip input and output for model bundles (a PSS/E case with its .con/.mon/.sub
 * files, a CGMES set...). Twin of the .NET ZipBundle, with no dependencies:
 * the platform's (De)CompressionStream('deflate-raw') does the compression, in
 * browsers and in Node alike. Entries are streamed, never held whole in memory.
 *
 * Reads stored and deflated entries; refuses encrypted and ZIP64 archives.
 */

import type { ByteSource } from './shared.ts';

/** A file that can be read at any offset (a Blob, a Node file handle...). */
export interface RandomAccess {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface ZipEntry {
  /** Normalized relative path, '/' separated. */
  readonly path: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly method: number;
  readonly crc: number;
  readonly headerOffset: number;
}

export class ZipError extends Error {}

/**
 * Normalized relative path, or null for entries to skip (directories, macOS
 * metadata). Throws for absolute paths and '..' segments (zip slip). Same rules
 * as ZipBundle.SafeRelativePath in the .NET edition.
 */
export function safeRelativePath(name: string): string | null {
  const n = name.replace(/\\/g, '/');
  if (n.length === 0 || n.endsWith('/')) return null;
  if (n.startsWith('/') || (n.length > 1 && n[1] === ':')) throw new ZipError(`zip entry '${name}' has an absolute path`);
  const parts = n.split('/').filter((p) => p.length > 0);
  if (parts.some((p) => p === '..')) throw new ZipError(`zip entry '${name}' points outside the archive`);
  const last = parts[parts.length - 1];
  if (parts[0] === '__MACOSX' || last === '.DS_Store' || last.startsWith('._')) return null;
  return parts.filter((p) => p !== '.').join('/');
}

// ─── CRC-32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// ─── reading ─────────────────────────────────────────────────────────────────

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const utf8 = new TextDecoder('utf-8');

/** List the files of a zip. `label` names the archive in error messages. */
export async function listZip(zip: RandomAccess, label = 'zip'): Promise<ZipEntry[]> {
  const tailLength = Math.min(zip.size, 22 + 0xffff);
  const tail = await zip.read(zip.size - tailLength, tailLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError(`${label}: not a zip file`);
  const count = u16(tail, eocd + 10);
  const cdSize = u32(tail, eocd + 12);
  const cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    throw new ZipError(`${label}: ZIP64 archives are not supported; zip the files with a standard tool`);
  const cd = await zip.read(cdOffset, cdSize);

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw new ZipError(`${label}: damaged central directory`);
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const crc = u32(cd, p + 16);
    const compressedSize = u32(cd, p + 20);
    const size = u32(cd, p + 24);
    const nameLength = u16(cd, p + 28);
    const extraLength = u16(cd, p + 30);
    const commentLength = u16(cd, p + 32);
    const headerOffset = u32(cd, p + 42);
    const rawName = utf8.decode(cd.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;

    const path = safeRelativePath(rawName);
    if (path === null) continue;
    if (flags & 1) throw new ZipError(`${label}: '${rawName}' is encrypted`);
    if (method !== 0 && method !== 8) throw new ZipError(`${label}: '${rawName}' uses an unsupported compression method (${method})`);
    if (size === 0xffffffff || compressedSize === 0xffffffff || headerOffset === 0xffffffff)
      throw new ZipError(`${label}: '${rawName}' needs ZIP64, which is not supported`);
    entries.push({ path, size, compressedSize, method, crc, headerOffset });
  }
  return entries;
}

/** Pipe chunks through a TransformStream, yielding its output as it comes. */
async function* through(ts: TransformStream<Uint8Array, Uint8Array>, input: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const writer = ts.writable.getWriter();
  const pump = (async () => {
    try {
      for await (const c of input) await writer.write(c);
      await writer.close();
    } catch (e) {
      await writer.abort(e).catch(() => {});
      throw e;
    }
  })();
  pump.catch(() => {});
  const reader = ts.readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
  await pump;
}

const CHUNK = 1 << 20;

async function* rawRange(zip: RandomAccess, offset: number, length: number): AsyncGenerator<Uint8Array> {
  for (let done = 0; done < length; ) {
    const n = Math.min(CHUNK, length - done);
    yield await zip.read(offset + done, n);
    done += n;
  }
}

/** Stream one entry's contents, checking its size and CRC. */
export async function* readEntry(zip: RandomAccess, e: ZipEntry, label = 'zip'): AsyncGenerator<Uint8Array> {
  const local = await zip.read(e.headerOffset, 30);
  if (u32(local, 0) !== 0x04034b50) throw new ZipError(`${label}: damaged entry '${e.path}'`);
  const start = e.headerOffset + 30 + u16(local, 26) + u16(local, 28);
  const raw = rawRange(zip, start, e.compressedSize);
  const data = e.method === 8 ? through(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, raw) : raw;
  let crc = 0;
  let size = 0;
  for await (const chunk of data) {
    crc = crc32(chunk, crc);
    size += chunk.length;
    yield chunk;
  }
  if (size !== e.size || crc !== e.crc) throw new ZipError(`${label}: '${e.path}' is corrupt (CRC or size mismatch)`);
}

/** An entry as a ByteSource the engine can read as often as it likes. */
export function entrySource(zip: RandomAccess, e: ZipEntry, name: string, label = 'zip'): ByteSource {
  return { name, size: e.size, open: () => readEntry(zip, e, label) };
}

export function blobAccess(blob: Blob): RandomAccess {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}

// ─── writing ─────────────────────────────────────────────────────────────────

/**
 * Streaming zip writer: deflates each entry as it is added and writes local
 * headers with data descriptors, so nothing is buffered whole. Entry names use
 * '/' separators and are flagged UTF-8.
 */
export class ZipWriter {
  private readonly out: (bytes: Uint8Array) => Promise<void> | void;
  private readonly central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;
  private readonly time: number;
  private readonly date: number;

  constructor(out: (bytes: Uint8Array) => Promise<void> | void, when = new Date()) {
    this.out = out;
    this.time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
    this.date = (Math.max(0, when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  }

  private async emit(b: Uint8Array) {
    await this.out(b);
    this.offset += b.length;
    if (this.offset > 0xffffffff) throw new ZipError('the zip would exceed 4 GB, which needs ZIP64; use a folder instead');
  }

  async add(entryName: string, data: AsyncIterable<Uint8Array>): Promise<void> {
    const name = new TextEncoder().encode(entryName.replace(/\\/g, '/'));
    const headerOffset = this.offset;
    const h = new Uint8Array(30 + name.length);
    const hv = new DataView(h.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 0x0808, true); // data descriptor + UTF-8 names
    hv.setUint16(8, 8, true);
    hv.setUint16(10, this.time, true);
    hv.setUint16(12, this.date, true);
    hv.setUint16(26, name.length, true);
    h.set(name, 30);
    await this.emit(h);

    let crc = 0;
    let size = 0;
    async function* counted() {
      for await (const c of data) {
        crc = crc32(c, crc);
        size += c.length;
        yield c;
      }
    }
    let compressed = 0;
    for await (const c of through(new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>, counted())) {
      compressed += c.length;
      await this.emit(c);
    }
    if (size > 0xffffffff) throw new ZipError(`'${entryName}' is over 4 GB, which needs ZIP64`);

    const d = new Uint8Array(16);
    const dv = new DataView(d.buffer);
    dv.setUint32(0, 0x08074b50, true);
    dv.setUint32(4, crc, true);
    dv.setUint32(8, compressed, true);
    dv.setUint32(12, size, true);
    await this.emit(d);

    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0808, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, this.time, true);
    cv.setUint16(14, this.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, headerOffset, true);
    c.set(name, 46);
    this.central.push(c);
    this.count++;
  }

  async finish(): Promise<void> {
    if (this.count > 0xfffe) throw new ZipError('too many files for one zip (ZIP64 is not supported)');
    const cdOffset = this.offset;
    for (const c of this.central) await this.emit(c);
    const e = new Uint8Array(22);
    const ev = new DataView(e.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, this.count, true);
    ev.setUint16(10, this.count, true);
    ev.setUint32(12, this.offset - cdOffset, true);
    ev.setUint32(16, cdOffset, true);
    await this.emit(e);
  }
}

/** Build a zip in memory (browser downloads). */
export async function zipToBlob(files: { name: string; data: Blob }[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const w = new ZipWriter((b) => { parts.push(b); });
  for (const f of files) {
    const access = blobAccess(f.data);
    await w.add(f.name, rawRange(access, 0, f.data.size));
  }
  await w.finish();
  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}
