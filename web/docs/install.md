# Install: TypeScript edition

| | Get it | Install |
|---|---|---|
| **A. Hosted page** | the project's GitHub Pages site (or your organisation's copy, see [deploy.md](deploy.md)) | nothing: open it in Chrome, Edge, Firefox or Safari |
| **B. Offline page** | `gridanon-web.html` from Releases | copy the file anywhere, double-click |
| **C. Node CLI** | `gridanon-node-<ver>.mjs` from Releases | Node.js 22+; no `npm install` |

To build them yourself instead, see [build.md](build.md).

## Verify downloads

Every release has a `SHA256SUMS` file. Check it before using a download on a machine that touches real models:

```powershell
(Get-FileHash .\gridanon-web.html -Algorithm SHA256).Hash.ToLower()     # Windows: compare with SHA256SUMS
```
```bash
sha256sum -c SHA256SUMS --ignore-missing          # Linux  (macOS: shasum -a 256 -c ...)
```

## A. Hosted page

Open the URL. That's all. To convince yourself nothing is uploaded, open the browser's developer tools → **Network**, then drop a file: no requests appear. You can also load the page, disconnect from the network, and keep working.

## B. Offline page (air-gapped)

1. Download `gridanon-web.html`.
2. Move it to the target machine (USB stick, file share).
3. Double-click it. It opens from `file://` with everything inlined: no server, no network, and a built-in policy that blocks any request.

Browser support: current Chrome, Edge, Firefox and Safari. In Chrome and Edge, **Save results straight into a folder** streams large outputs to disk; other browsers keep results in memory (fine up to a few hundred MB).

## C. Node CLI

1. Install Node.js 22 or later from https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`, `brew install node`), then check with `node --version`.
2. Download `gridanon-node-<ver>.mjs`, rename it to `gridanon-node.mjs` if you like, and run:
   ```bash
   node gridanon-node.mjs version
   ```
3. Optional, to type `gridanon` instead:
   - Windows: create `gridanon.cmd` next to it containing `@node "%~dp0gridanon-node.mjs" %*`, and put that folder on `PATH`.
   - Linux/macOS: `chmod +x gridanon-node.mjs && ln -s "$PWD/gridanon-node.mjs" ~/.local/bin/gridanon`.

Then see [run.md](run.md).
