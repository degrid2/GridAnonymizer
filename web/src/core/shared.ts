/**
 * Contracts, I/O abstraction and helpers shared by every format.
 *
 * The core never touches a filesystem or the DOM: inputs are re-openable byte
 * sources and outputs are text sinks, so the same engine runs in a browser
 * Worker (File / FileSystemWritableFileStream / Blob) and in Node (fs streams).
 */

import type { MappingDocument } from './mapping.ts';
import type { Profile } from './profile.ts';

// ─── I/O ─────────────────────────────────────────────────────────────────────

export type TextEncoding = 'utf8' | 'latin1';

/** A file that can be read more than once (pass 1, pass 2, audit). */
export interface ByteSource {
  readonly name: string;
  readonly size: number;
  open(): AsyncIterable<Uint8Array>;
}

export interface TextSink {
  write(text: string): void | Promise<void>;
}

/** Where outputs go. `create` returns a sink; `commit` makes it final and returns it for re-reading. */
export interface OutputTarget {
  create(name: string, encoding: TextEncoding): Promise<OutputFile>;
}

export interface OutputFile {
  readonly name: string;
  readonly sink: TextSink;
  commit(): Promise<ByteSource>;
  abort(): Promise<void>;
}

const utf8Encoder = new TextEncoder();

export function encode(text: string, encoding: TextEncoding): Uint8Array {
  if (encoding === 'utf8') return utf8Encoder.encode(text);
  // Same as .NET's Latin1 encoder: characters above U+00FF become '?'.
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c > 0xff ? 0x3f : c;
  }
  return out;
}

/** Decode a byte stream to text chunks. latin1 is true ISO-8859-1 (every byte round-trips), not windows-1252. */
export async function* decode(source: ByteSource, encoding: TextEncoding): AsyncGenerator<string> {
  if (encoding === 'utf8') {
    const d = new TextDecoder('utf-8');
    for await (const bytes of source.open()) {
      const s = d.decode(bytes, { stream: true });
      if (s) yield s;
    }
    const tail = d.decode();
    if (tail) yield tail;
    return;
  }
  // .NET's StreamReader honours a UTF-8 byte-order mark even when told Latin-1; do the same.
  let first = true;
  let utf8: TextDecoder | undefined;
  for await (const raw of source.open()) {
    let bytes = raw;
    if (first) {
      first = false;
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) utf8 = new TextDecoder('utf-8');
    }
    if (utf8) {
      const t = utf8.decode(bytes, { stream: true });
      if (t) yield t;
      continue;
    }
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
    }
    if (s) yield s;
    void bytes;
  }
  if (utf8) {
    const t = utf8.decode();
    if (t) yield t;
  }
}

/** .NET's char.IsWhiteSpace set (JS trim() differs: it omits U+0085 and adds U+FEFF). */
const NET_WS = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const isWs = (c: string) => NET_WS.test(c);
export function netTrim(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isWs(s[a])) a++;
  while (b > a && isWs(s[b - 1])) b--;
  return s.slice(a, b);
}
export function netTrimEnd(s: string): string {
  let b = s.length;
  while (b > 0 && isWs(s[b - 1])) b--;
  return s.slice(0, b);
}

/** Lines exactly as .NET's TextReader.ReadLine splits them: \r\n, \n or a lone \r. */
export async function* readLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let carry = '';
  let pendingCr = false;
  for await (const chunk of chunks) {
    let start = 0;
    let i = 0;
    if (pendingCr) {
      pendingCr = false;
      if (chunk[0] === '\n') start = i = 1;
    }
    for (; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (c === 10 || c === 13) {
        yield carry + chunk.slice(start, i);
        carry = '';
        if (c === 13) {
          if (i + 1 < chunk.length) {
            if (chunk.charCodeAt(i + 1) === 10) i++;
          } else pendingCr = true;
        }
        start = i + 1;
      }
    }
    carry += chunk.slice(start);
  }
  if (carry.length > 0) yield carry;
}

/** The input's line ending: "\r\n" if the first \n in the first 64 KB follows a \r, else "\n". */
export async function detectNewLine(source: ByteSource): Promise<string> {
  let seen = 0;
  let prev = -1;
  for await (const bytes of source.open()) {
    for (let i = 0; i < bytes.length && seen < 65536; i++, seen++) {
      if (bytes[i] === 10) return prev === 13 ? '\r\n' : '\n';
      prev = bytes[i];
    }
    if (seen >= 65536) break;
  }
  return '\n';
}

/** First `chars` characters of a source, decoded as UTF-8, for format sniffing. */
export async function readHead(source: ByteSource, bytesWanted = 16 * 1024): Promise<string> {
  const parts: Uint8Array[] = [];
  let got = 0;
  for await (const b of source.open()) {
    parts.push(b);
    got += b.length;
    if (got >= bytesWanted) break;
  }
  const all = new Uint8Array(Math.min(got, bytesWanted));
  let off = 0;
  for (const p of parts) {
    const take = Math.min(p.length, all.length - off);
    all.set(p.subarray(0, take), off);
    off += take;
    if (off >= all.length) break;
  }
  return new TextDecoder('utf-8').decode(all);
}

/** A ByteSource over in-memory text (tests, samples, the browser's Blob results). */
export function memorySource(name: string, data: Uint8Array | string): ByteSource {
  const bytes = typeof data === 'string' ? utf8Encoder.encode(data) : data;
  return {
    name,
    size: bytes.length,
    async *open() {
      for (let i = 0; i < bytes.length; i += 1 << 20) yield bytes.subarray(i, i + (1 << 20));
    },
  };
}

// ─── reports ─────────────────────────────────────────────────────────────────

export interface AuditResult {
  hunted: number;
  vocabularyExcluded: number;
  leakedNames: string[];
  leakedIds: string[];
  leakedTerms: string[];
  integrityIssues: string[];
  clean: boolean;
}

export function auditResult(p: Partial<AuditResult>): AuditResult {
  const r: AuditResult = {
    hunted: 0, vocabularyExcluded: 0, leakedNames: [], leakedIds: [], leakedTerms: [], integrityIssues: [], clean: true,
    ...p,
  };
  r.clean = r.leakedNames.length === 0 && r.leakedIds.length === 0 && r.leakedTerms.length === 0 && r.integrityIssues.length === 0;
  return r;
}

export interface FileReport {
  input: string;
  output?: string;
  format: string;
  bytesIn: number;
  bytesOut: number;
  stats: Record<string, number>;
  audit?: AuditResult;
  warnings: string[];
}

export function newReport(input: ByteSource, format: string): FileReport {
  return { input: input.name, format, bytesIn: input.size, bytesOut: 0, stats: {}, warnings: [] };
}

export function count(r: FileReport, key: string, by = 1): void {
  r.stats[key] = (r.stats[key] ?? 0) + by;
}

export interface RunReport {
  tool: string;
  mode: 'anonymize' | 'restore';
  started: string;
  profile?: string;
  files: FileReport[];
  clean: boolean;
}

// ─── formats ─────────────────────────────────────────────────────────────────

export interface JobContext {
  profile: Profile;
  salt: string;
  mapping?: MappingDocument;
  restore: boolean;
}

export interface FormatJob {
  scan(source: ByteSource): Promise<void>;
  buildMaps(): void;
  rewrite(source: ByteSource, out: OutputFile): Promise<FileReport>;
  audit(original: ByteSource, output: ByteSource): Promise<AuditResult>;
  exportTo(mapping: MappingDocument): void;
}

export interface FormatHandler {
  readonly id: string;
  readonly description: string;
  readonly extensions: readonly string[];
  readonly encoding: TextEncoding;
  sniff(head: string): boolean;
  createJob(ctx: JobContext): FormatJob;
}

export class NotSupportedError extends Error {}

// ─── rules ───────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export { escapeRe };

/** Profile-level rules that apply to every format. */
export class GlobalRules {
  readonly redactTerms: string[];
  readonly redactionText: string;
  private readonly preserve: RegExp[];
  private readonly redact?: RegExp;

  constructor(profile: Profile) {
    this.preserve = profile.preserveNames.map((p) => new RegExp(p));
    this.redactTerms = profile.redactTerms.filter((t) => netTrim(t).length > 0);
    this.redactionText = profile.redactionText;
    if (this.redactTerms.length > 0) {
      const alt = [...this.redactTerms].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
      this.redact = new RegExp(alt, 'gi');
    }
  }

  isPreserved(name: string): boolean {
    return this.preserve.some((r) => r.test(name));
  }

  get hasRedactions(): boolean {
    return this.redact !== undefined;
  }

  redactText(text: string, report?: FileReport): string {
    if (!this.redact) return text;
    return text.replace(this.redact, () => {
      if (report) count(report, 'redactions');
      return this.redactionText;
    });
  }

  findTerms(text: string): string[] {
    if (!this.redact) return [];
    const lower = text.toLowerCase();
    return this.redactTerms.filter((t) => lower.includes(t.toLowerCase()));
  }
}

/** Sequential pseudonym generator that never reuses a name already taken. */
export class NameCounter {
  private readonly counters = new Map<string, number>();
  private readonly used: Set<string>;

  constructor(alreadyUsed: Iterable<string>) {
    this.used = new Set(alreadyUsed);
  }

  isUsed(c: string): boolean {
    return this.used.has(c);
  }

  markUsed(c: string): void {
    this.used.add(c);
  }

  next(key: string): number {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }

  nextName(prefix: string, width = 4, separator = '_'): string {
    for (;;) {
      const candidate = prefix + separator + String(this.next(prefix)).padStart(width, '0');
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        return candidate;
      }
    }
  }
}

/** Copy a Map into a plain record safely (no prototype keys). */
export const toRecord = <V>(m: Map<string, V>): Record<string, V> => Object.fromEntries(m);
