# GridAnonymizer

Anonymize CIM/CGMES and PSS®E RAW power-system models on your own machine, then prove nothing identifying survived.

This repository holds **two independent editions** of the same tool. Each folder is complete on its own, with its own documentation, samples, profiles and tests. Download or use just the one you want.

| | [**.NET edition**](dotnet/) | [**TypeScript edition**](web/) |
|---|---|---|
| What you run | `gridanon`: one native executable (CLI + browser UI via `gridanon ui`), or a NuGet library | a web page (hosted, or one offline `.html` file), or a Node.js CLI |
| Needs | nothing (Windows, Linux, macOS) | a browser, or Node.js 22+ for the CLI |
| Best for | large models, scripts, CI, embedding in .NET tools | zero-install use, air-gapped machines, sharing a link |
| Start here | [dotnet/README.md](dotnet/README.md) | [web/README.md](web/README.md) |

Both editions have the same UI and produce byte-identical output from the same inputs and salt. Mapping files and profiles work in either.

**Building from a clone:** `build.sh` (Linux, macOS) and `build.ps1` (Windows; PowerShell 7 anywhere) build either edition or both, with the same options. Both editions build and run on Windows, Linux and macOS. Each folder's `docs/build.md` has the details.

```bash
./build.sh                    # both: TypeScript first, then gridanon ui gets the same page, then .NET
./build.sh dotnet --native    # .NET only, as a standalone native executable
./build.sh web --test         # TypeScript only, then its tests
./build.sh --test --run       # both, all tests (including cross-edition parity), then start gridanon ui
```
```powershell
.\build.ps1                   # the same on Windows: -Native, -Test, -Run
.\build.ps1 dotnet -Native
```

**Downloads:** every release on the Releases page has ready-to-run files for both editions (`gridanon-<ver>-<os>.zip`, `gridanon-web.html`, `gridanon-node-<ver>.mjs`) and a source zip of each folder (`gridanon-dotnet-src-<ver>.zip`, `gridanon-web-src-<ver>.zip`), plus `SHA256SUMS`.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [MIT License](LICENSE)
