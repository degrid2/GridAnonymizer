# Build from source: .NET edition

You only need this to change the code or to build a binary yourself. To use the tool, [install](install.md) a release.

## Prerequisites

| | Version | Check |
|---|---|---|
| .NET SDK | **10.0.403 or later** | `dotnet --list-sdks` |
| C/C++ toolchain (only for native binaries) | Windows: Visual Studio 2022+ with **Desktop development with C++**; Linux: `clang` and `zlib1g-dev`; macOS: Xcode command-line tools (`xcode-select --install`) | |

Why 10.0.403: earlier .NET 10 SDKs bundle a native AOT compiler with a published high-severity vulnerability. Restore fails on purpose (NU1903 is treated as an error), and `global.json` pins the minimum so this shows up immediately.

Installing the SDK:
```powershell
winget install Microsoft.DotNet.SDK.10        # Windows, side by side with Visual Studio's SDK
```
```bash
# Linux/macOS: https://dotnet.microsoft.com/download/dotnet/10.0 or your package manager
```
Open a new terminal afterwards. Inside this folder, `dotnet --version` should report 10.0.403 or later.

**Shortcut:** from the repository root, `./build.sh dotnet` (Linux, macOS) or `.\build.ps1 dotnet` (Windows) checks the prerequisites and builds this edition. Add `--native`/`-Native` for the native executable, `--test`/`-Test` to run the tests. Leave out `dotnet` to build both editions.

## Build and run from source

Run everything from this folder (the one containing `GridAnonymizer.slnx`):

```bash
dotnet build                                            # debug build of everything
dotnet run --project src/GridAnonymizer.Cli -- version  # run the CLI without publishing
dotnet run --project src/GridAnonymizer.Cli -- ui       # run the UI
```

## Native executable (what releases ship)

```bash
dotnet publish src/GridAnonymizer.Cli -c Release -r win-x64 -o out
```

Runtime ids: `win-x64`, `win-arm64`, `linux-x64`, `linux-arm64`, `osx-arm64`. Native AOT can't cross-compile between operating systems: build Windows binaries on Windows, and so on.

The result is `out/gridanon(.exe)`, about 8 MB, with no runtime needed. Copy it anywhere. The `.pdb`/`.dbg` files next to it are debug symbols and don't need to be shipped.

## NuGet packages

```bash
dotnet pack src/GridAnonymizer.Core -c Release -o packages   # library
dotnet pack src/GridAnonymizer.Cli  -c Release -o packages   # dotnet tool
dotnet tool install -g GridAnonymizer --add-source ./packages # try the tool locally
```

## The UI page (`src/GridAnonymizer.Cli/wwwroot`)

`gridanon ui` serves a static page embedded in the executable. The page is built from the TypeScript edition's UI and **committed here**, so building this edition never needs Node.js. If you change the UI, regenerate it from a TypeScript edition checkout (`npm run build:dotnet-ui -- <path-to-this-folder>`) and commit the new `wwwroot/`. Details: [ui.md](ui.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `NU1903 ... Microsoft.DotNet.ILCompiler ... known high severity vulnerability` | Your SDK is too old. Install 10.0.403+ (see above). |
| `A compatible .NET SDK was not found` / `global.json` error | Same: install SDK 10.0.403 or later. |
| `Platform linker not found` (publishing) | Install the C/C++ toolchain for your OS (see Prerequisites). |
| `error : ... is not supported for cross-compilation` | Build each OS's binary on that OS. |
| Test project fails to find `samples/` | Run commands from this folder; the tests copy `samples/` and `tests/golden/` next to themselves. |
