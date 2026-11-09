# Architecture: TypeScript edition

```
index.html + src/app/main.ts      the page (framework-free; user text only via textContent)
        │  Backend interface (src/app/backend.ts)
        ├─ backend-worker.ts  →  worker.ts  →  src/core   browser build: engine in a Web Worker
        └─ backend-server.ts  →  HTTP to `gridanon ui`     dotnet build: the .NET engine does the work
cli/gridanon.ts  →  src/core                               Node CLI
src/core: engine.ts · cim.ts · psse.ts · text.ts · profile.ts · mapping.ts · hash.ts · shared.ts · xml-chunker.ts
```

The core performs no I/O itself: inputs are re-openable `ByteSource`s and outputs `OutputTarget`s, adapted to `File`/Blob/File System Access in the browser (`src/app/browser-io.ts`) and to `fs` in Node (`cli/node-io.ts`).

## A run

1. **Detect:** sniff the first 16 KB, then the extension.
2. **Group:** by format; structured formats first, `text` last so it reuses the names just mapped.
3. **Scan (pass 1):** inventory ids, names, references and vocabulary of every file in the group.
4. **Build maps:** one mapping per group, seeded by *continue from a mapping*.
5. **Rewrite (pass 2):** stream each file, replace identity tokens only, keep every other byte.
6. **Audit:** re-read each output and hunt for original names, ids and redact terms; check PSS®E bus references.

Pseudonyms are HMAC-SHA256(salt, …). SHA-256/HMAC are implemented in `hash.ts` (pure and synchronous) so the browser, Node and the .NET edition agree exactly. The rules themselves are described in [formats/cim.md](formats/cim.md) and [formats/psse.md](formats/psse.md).

## Compatibility with the .NET edition

Both editions produce identical bytes, and `test/parity.test.ts` checks it. Where JavaScript and .NET differ, the TypeScript side reproduces .NET explicitly: `netTrim` (.NET's whitespace set), `readLines` (.NET's `ReadLine` splitting), Latin-1 encoding with `?` for unencodable characters, and UTF-8 BOM handling in RAW files. Keep it that way: a behaviour change here belongs in the .NET edition too.

## The page's guarantees

- **No requests after load** in the browser build. Samples and profiles are inlined, and the worker is a `blob:` URL. CSP `connect-src 'none'` via header and `<meta>`; the offline page pins its inline script by SHA-256.
- **Classic (iife) worker:** browsers refuse module workers from `blob:` URLs on `file://` pages, and the offline page must work from disk.
- **Single script chunk** (`inlineDynamicImports`), so the offline page can inline everything.
