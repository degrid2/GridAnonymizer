# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
