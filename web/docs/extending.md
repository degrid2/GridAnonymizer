# Adding a format: TypeScript edition

1. Create `src/core/<name>.ts` exporting a `FormatHandler` (`id`, `description`, `extensions`, `encoding`, `sniff(head)`, `createJob(ctx)`, and optionally `phase`: 0 for a model, 1 for a file that follows a model in the same run and reads `ctx.mapping`, like `psse-aux.ts`, 2 for free text).
2. Implement `FormatJob`:
   - `scan(source)`: inventory identifying values (called for every file before any rewrite)
   - `buildMaps()`: create pseudonyms. Honour `ctx.mapping` (continue) and `ctx.restore` (invert).
   - `rewrite(source, out)`: stream, replace identity tokens only, `count(report, ...)` what changed; `await out.commit()` at the end, `out.abort()` on error
   - `audit(original, output)`: hunt for the original values
   - `exportTo(mapping)`: add your pairs to the `MappingDocument`
3. Register it in `formats` in `src/core/engine.ts`, and add it to the format list in `src/app/main.ts`.
4. Add profile options if needed (`src/core/profile.ts`, `docs/profiles.md`).
5. Add a fictional sample under `samples/` and tests in `test/`: anonymize → audit clean → restore round trip.

Keep `src/core` free of DOM and Node APIs, and use erasable TypeScript only. If the .NET edition should support the format too, implement it there with identical output; the parity test will hold you to it.
