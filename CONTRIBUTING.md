# Contributing

Thanks for helping. A few ground rules keep this project trustworthy for the utilities that rely on it.

## Never share a real model

Do not attach customer, utility or TSO models to issues, pull requests or test data. That includes "already anonymized" models, which can be recognised from their topology. Reduce the problem to a few hand-written records using fictional names, like the files in `samples/`.

## Two editions

`dotnet/` and `web/` are self-contained: each builds, tests and documents itself without the other. Their build, run and test guides are in `dotnet/docs/` and `web/docs/`.

They are also **twins**: the same inputs and salt produce byte-identical output. CI enforces this with a parity test, so:

- **A behaviour change goes into both editions in the same pull request**, with tests on each side. If you only know one language, open the PR with your side done and say so; someone can port it.
- `profiles/`, `samples/` and the v1 golden files exist in both folders (`dotnet/tests/golden`, `web/test/golden`) and must stay identical. Edit one, copy it to the other; `node .github/scripts/check-sync.mjs` verifies.
- The .NET edition's UI (`dotnet/src/GridAnonymizer.Cli/wwwroot/`) is built from `web/` with `npm run build:dotnet-ui`. If you change the page, regenerate and commit it; the sync check verifies this too.
- The profile schema and the mapping format (`gridanon-mapping/1`) are shared contracts.
- Default-profile CIM output must stay byte-identical to the v1 golden files.

## Rules

- **No new runtime dependencies** in either edition. Build and test tools are fine.
- .NET: warnings are errors, `dotnet format` clean, AOT-safe (source-generated JSON only).
- TypeScript: strict typecheck, erasable syntax only in `src/core`, no DOM or Node APIs there.
- Add a line to `CHANGELOG.md` under *Unreleased*.

## Releasing (maintainers)

Bump `<Version>` in `dotnet/Directory.Build.props`, `version` in `web/package.json` and `web/src/core/version.ts`, then tag `vX.Y.Z` on `main`. The release workflow builds and tests both editions and publishes the binaries, the web files, a source zip of each folder, NuGet packages and `SHA256SUMS`.
