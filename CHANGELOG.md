# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- PSS®E companion files (`psse-aux` format): `.con`, `.mon`, `.sub` and `.aux` files run after the case and follow it. Bus numbers are renumbered with the case, `BUSES a TO b` ranges are expanded, extended bus names follow the case, and labels (contingencies, subsystems, interfaces…) get pseudonyms that also reach result CSVs. Warnings for buses missing from the case, and for renumbering without the case.
- Zip bundles: a `.zip` input comes back as `<name>_anonymized.zip` with the same folders and original file names inside; `--zip <file>` packs a run's outputs into one archive. Zip slip and macOS metadata are handled; no new dependencies (the TypeScript edition has its own small streaming zip reader and writer).
- UI: drop a `.zip` or several files; a **PSS®E set** panel shows the case and its optional parts and adds a missing one in a click; *Download all as …zip* returns everything in one zip. `gridanon ui` also writes that zip to its output folder.
- The sample set includes `meridian_v33.con`, `.mon` and `.sub`.
- `build.ps1` at the root builds one or both editions, optionally runs the tests and starts the UI.

### Changed
- `.con`, `.mon` and `.sub` are no longer treated as plain text: they use the `psse-aux` format.
- Engine: formats run in phases (models, then PSS®E companions, then text); inputs can carry a relative folder that their outputs keep.

### Fixed
- The page stopped working (Anonymize did nothing, no help buttons) when a profile chosen on an earlier visit was restored at start-up.

## [2.0.0] - 2026-11-07

Two editions of one engine: a new C#/.NET command-line tool and library, and the v1 TypeScript browser tool upgraded to the same feature set (plus an offline single-file page and a Node CLI). Both produce byte-identical output; CI enforces it.

### Added
- PSS®E RAW support (rev 30–35): names, case titles, comments, substation coordinates, optional bus renumbering with a referential-integrity audit.
- `text` format: rewrite companion files (CSV results, contingency lists) with the same mapping.
- JSON profiles for per-customer rules; ready-made `vendor-strict`, `cgmes-boundary` and `names-only` profiles.
- `restore` command: translate anonymized names, ids and bus numbers back with the private mapping.
- `--use-mapping`: anonymize a new model revision consistently with an earlier one.
- Redact terms: organisation names that must never survive, hunted by the audit.
- CIM: GL coordinates and address fields overwritten; boundary-set references can be kept; id preserve patterns.
- Native AOT single-file binaries for Windows, Linux and macOS; `dotnet tool` package; `GridAnonymizer.Core` library.
- TypeScript edition: browser page with Anonymize/Restore modes, per-file format override, profiles, mapping in/out, redact terms and streaming to a folder; `gridanon-web.html` offline single-file page; `gridanon-node.mjs` Node CLI with the same arguments as the native one.
- `gridanon ui` (.NET edition): the same page as the TypeScript edition, served on 127.0.0.1 only and backed by the .NET engine; per-launch token, Host/Origin checks, private temp uploads.
- Each edition is a self-contained folder with its own install, build, run and test guides, samples, profiles and tests.
- Cross-edition parity test and a headless browser smoke test (offline page, hosted page, `gridanon ui`) in CI.
- Exit code 2 when the audit finds anything, for use in pipelines.

### Changed
- CIM output is byte-identical to v1 for the same salt and default options.
- The browser page's CSP is now `connect-src 'none'`: samples are inlined, so the page makes no request at all after loading.

### Fixed
- A chunk boundary could separate a name from its closing tag and let it through (v1).
- Multi-file CGMES sets with SSH listed before EQ left EQ names un-renamed (v1).
- Preserved names containing XML entities were double-escaped (v1).
