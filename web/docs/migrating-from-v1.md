# Migrating from the v1 web tool

v1 lives on as this **TypeScript edition**. It has the same stack (TypeScript, Vite, a Web Worker, the zero-dependency `server.mjs`) and the same look, upgraded to the full v2 feature set. If you hosted v1, deploy this folder the same way: `npm ci && npm run build:web`, then serve `dist/` ([deploy.md](deploy.md)). The page no longer fetches anything after load, so the CSP is now `connect-src 'none'`.

v2 also adds a separate C#/.NET edition with identical behaviour.

| v1 (browser) | v2 (page / `gridanon` CLI) |
|---|---|
| salt field | `--salt` (or `--salt-env VAR`) |
| "keep type hints" | profile `cim.keepTypeHints: true` |
| "keep comments" | `--keep-comments` |
| "download mapping" | `-m map.json` |
| self-check | the audit, on by default, exit code 2 on failure |

For the same salt and default options, CIM output is byte-identical to v1 (`test/golden`, checked by `test/core.test.ts`), so you can anonymize the rest of a set with v2 and it will still join files produced by v1.

v1 mapping files (`ids`/`names`/`mrids`/`descs` as arrays of pairs) can be converted into v2 `cim` objects with a few lines of script. v2 mapping files also carry the salt.

v2 differs from v1 in three places, all deliberate fixes:
- A chunk boundary can no longer fall between `<name>VALUE` and its closing tag. In v1, on large files, this could let a value through un-renamed.
- When merging a multi-file set, a missing name is filled from later files, so SSH-before-EQ ordering no longer leaves EQ names un-renamed.
- An already-escaped preserved name (`A &amp; B`) is no longer double-escaped.
