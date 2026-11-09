/**
 * Keyed, deterministic pseudonyms - the TypeScript twin of
 * dotnet/.../Hashing/Pseudonym.cs. SHA-256/HMAC are implemented here (pure and
 * synchronous) so the browser, Node and .NET all produce identical output for
 * the same salt.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const W = new Uint32Array(64);

export function sha256(bytes: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = bytes.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = len * 8;
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i], false);
  return out;
}

const encoder = new TextEncoder();
let cachedSalt: string | undefined;
let ipadKey = new Uint8Array(64);
let opadKey = new Uint8Array(64);

export function hmac(salt: string, message: string): Uint8Array {
  if (salt !== cachedSalt) {
    let k: Uint8Array = encoder.encode(salt);
    if (k.length > 64) k = sha256(k);
    const pad = new Uint8Array(64);
    pad.set(k);
    ipadKey = pad.map((x) => x ^ 0x36);
    opadKey = pad.map((x) => x ^ 0x5c);
    cachedSalt = salt;
  }
  const msg = encoder.encode(message);
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipadKey);
  inner.set(msg, 64);
  const outer = new Uint8Array(96);
  outer.set(opadKey);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export const hexDigest = (salt: string, message: string, length: number): string => toHex(hmac(salt, message)).slice(0, length);

export function newSalt(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

const RE_UUID = /^_?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const RE_NUMERIC = /^(_)(\d+)((?:_\d+)*)$/;

/** Format-preserving identifier: a UUID stays a UUID, `_123` stays numeric, `urn:uuid:` stays a URN. */
export function newIdFor(salt: string, oldId: string): string {
  if (oldId.startsWith('urn:uuid:')) {
    const inner = newIdFor(salt, oldId.slice(9));
    return 'urn:uuid:' + (inner.startsWith('_') ? inner.slice(1) : inner);
  }
  if (RE_UUID.test(oldId)) {
    const h = toHex(hmac(salt, 'id ' + oldId));
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
    return oldId.startsWith('_') ? '_' + uuid : uuid;
  }
  const m = RE_NUMERIC.exec(oldId);
  if (m) {
    const h = hmac(salt, 'id ' + oldId);
    let s = '_' + ((h[9] % 9) + 1);
    for (let i = 0; i < 9; i++) s += h[i] % 10;
    return s + m[3];
  }
  return '_' + hexDigest(salt, 'id ' + oldId, 24);
}
