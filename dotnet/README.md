# GridAnonymizer: .NET edition

**Anonymize CIM/CGMES and PSS®E RAW network models on your own machine, then prove nothing identifying survived.**

The .NET edition is one self-contained executable, `gridanon`, with:

- **a command line** for scripts, CI and large models;
- **a browser UI** (`gridanon ui`) that opens the GridAnonymizer page on this computer. The UI is served from `127.0.0.1` only, and the .NET engine does the work;
- **a library** (`GridAnonymizer.Core` on NuGet) to embed in your own tools.

It has no runtime dependencies beyond the .NET base class library, makes no network calls and sends no telemetry. Native builds need nothing installed.

Names, ids, descriptions, comments, coordinates and (optionally) PSS®E bus numbers get consistent pseudonyms. Impedances, ratings, topology and every other electrical value stay exactly as they were. Every output is re-read and audited for anything that got through. A PSS®E case can bring its `.con`, `.mon`, `.sub` and `.aux` files, loose or in one `.zip`; they follow the case, and a zip comes back as a zip.

## Five-minute start

```powershell
# 1. Install: download gridanon-<ver>-win-x64.zip from Releases, unzip, then:
gridanon version

# 2a. Use the UI: opens your browser at http://localhost:<port>/
gridanon ui

# 2b. Or the command line: anonymize the bundled samples, keep the private mapping
gridanon anonymize samples\cim samples\psse --renumber-buses -m private\map.json

# 3. Translate a vendor's results back to real names
gridanon restore anonymized\study_results_anonymized.csv --mapping private\map.json
```

Exit code `0` means clean, `1` means error, `2` means the audit found something identifying: don't share that file.

## Documentation

| | |
|---|---|
| **[Install](docs/install.md)** | download, verify the checksum, put it on `PATH` (Windows, Linux, macOS); `dotnet tool`; NuGet library |
| **[Build](docs/build.md)** | build from source: SDK, native AOT binaries, NuGet packages |
| **[Run](docs/run.md)** | every command and option, the UI, typical workflows, using the library |
| **[Test](docs/test.md)** | automated tests and a manual walkthrough with the samples |
| [Profiles](docs/profiles.md) | per-customer rules in JSON: what each setting does |
| [CIM / CGMES](docs/formats/cim.md) · [PSS®E RAW](docs/formats/psse.md) | exactly what changes in each format |
| [UI](docs/ui.md) | how `gridanon ui` works and why it is safe |
| [Architecture](docs/architecture.md) · [Adding a format](docs/extending.md) | for contributors |

## What's in this folder

```
src/GridAnonymizer.Core/   the engine (library): formats, profiles, mapping, audit
src/GridAnonymizer.Cli/    the `gridanon` executable: commands, and the UI server (wwwroot/ = the page)
tests/                     xUnit tests; tests/golden = reference output of the original v1 tool
profiles/                  ready-made profiles: vendor-strict, cgmes-boundary, names-only, default
samples/                   fictional CIM, CGMES and PSS®E models to try everything on
docs/                      the guides above
```

Use cases at a glance:

| Profile | When |
|---|---|
| *(default)* | Most sharing: names, ids, mRIDs, descriptions, comments, headers, coordinates. Bus numbers kept. |
| `profiles/vendor-strict.json` | The model leaves the organisation: everything, plus shuffled bus renumbering and redact terms. |
| `profiles/cgmes-boundary.json` | A CGMES IGM that must still merge with the ENTSO-E boundary set. |
| `profiles/names-only.json` | Internal test data: ids, mRIDs and bus numbers stay stable. |

A **TypeScript edition** with the same engine and the same page also exists, for running entirely inside a browser tab or as an offline single HTML file. Output, mapping files and profiles are interchangeable between the two editions.

## License

[MIT](LICENSE). PSS®E is a trademark of Siemens. CGMES is published by ENTSO-E. This project is not affiliated with either.
