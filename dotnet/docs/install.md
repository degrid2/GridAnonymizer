# Install: .NET edition

Pick one of three ways. Most people want **A**.

| | What you get | Needs |
|---|---|---|
| **A. Native executable** | `gridanon` (CLI + UI) | nothing |
| **B. .NET global tool** | `gridanon` (CLI + UI) | .NET 10 runtime |
| **C. NuGet library** | `GridAnonymizer.Core` in your own code | .NET 10 |

To build it yourself instead, see [build.md](build.md).

---

## A. Native executable

### 1. Download

From the project's **Releases** page, download the zip for your machine and the `SHA256SUMS` file:

| Machine | File |
|---|---|
| Windows (Intel/AMD) | `gridanon-<ver>-win-x64.zip` |
| Windows on ARM | `gridanon-<ver>-win-arm64.zip` |
| Linux (Intel/AMD) | `gridanon-<ver>-linux-x64.zip` |
| Linux on ARM | `gridanon-<ver>-linux-arm64.zip` |
| macOS (Apple silicon) | `gridanon-<ver>-osx-arm64.zip` |

### 2. Verify the checksum

Do this on any machine that will touch real models.

```powershell
# Windows PowerShell: compare with the matching line in SHA256SUMS
(Get-FileHash .\gridanon-2.0.0-win-x64.zip -Algorithm SHA256).Hash.ToLower()
```
```bash
# Linux
sha256sum -c SHA256SUMS --ignore-missing
# macOS
shasum -a 256 -c SHA256SUMS --ignore-missing
```

### 3. Unzip and put it on PATH

**Windows**
1. Unzip to a folder, for example `C:\Tools\gridanon\`. The zip holds `gridanon.exe`, `profiles\`, `README.md` and `LICENSE`.
2. Add the folder to `PATH`: Start → "Edit environment variables for your account" → `Path` → **New** → `C:\Tools\gridanon` → OK.
3. Open a **new** terminal:
   ```powershell
   gridanon version
   ```
   If SmartScreen blocks the first run, choose **More info → Run anyway**, or run `Unblock-File C:\Tools\gridanon\gridanon.exe` once. The binary is not code-signed; the checksum is your integrity check.

**Linux**
```bash
mkdir -p ~/.local/gridanon && unzip gridanon-<ver>-linux-x64.zip -d ~/.local/gridanon
chmod +x ~/.local/gridanon/gridanon
mkdir -p ~/.local/bin && ln -sf ~/.local/gridanon/gridanon ~/.local/bin/gridanon
gridanon version
```

**macOS**
```bash
mkdir -p ~/gridanon && unzip gridanon-<ver>-osx-arm64.zip -d ~/gridanon
xattr -d com.apple.quarantine ~/gridanon/gridanon     # not notarized
chmod +x ~/gridanon/gridanon
sudo ln -sf ~/gridanon/gridanon /usr/local/bin/gridanon
gridanon version
```

### 4. Check that it works

```bash
gridanon ui            # your browser opens the GridAnonymizer page; Ctrl+C to stop
```

Then go to [run.md](run.md).

**Uninstall:** delete the folder (and the `PATH` entry or symlink). Nothing else is written outside the folders you point it at.

---

## B. .NET global tool

If the .NET 10 runtime (or SDK) is already installed:

```bash
dotnet tool install -g GridAnonymizer
gridanon version
dotnet tool update -g GridAnonymizer      # later
dotnet tool uninstall -g GridAnonymizer   # remove
```

---

## C. NuGet library

```bash
dotnet add package GridAnonymizer.Core
```

See "Using the library" in [run.md](run.md#using-the-library).
