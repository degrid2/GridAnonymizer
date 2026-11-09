# Build from source: TypeScript edition

## Prerequisites

| | Version | Check |
|---|---|---|
| Node.js | **22.6 or later** | `node --version` |
| npm | comes with Node | `npm --version` |

Install Node: https://nodejs.org, `winget install OpenJS.NodeJS.LTS`, or `brew install node`.

## Build

From this folder:

```bash
npm ci            # dev tools only: vite, typescript, playwright. Nothing here ships to users.
npm run build     # everything below
```

| Output | What it is | Command on its own |
|---|---|---|
| `dist/` | the hosted site (`index.html`, `assets/`, `_headers`) | `npm run build:web` |
| `dist/gridanon-web.html` | the offline single-file page | `npm run build:offline` (after `build:web`) |
| `dist-cli/gridanon.mjs` | the Node CLI, one dependency-free file | `npm run build:cli` |
| `dist-dotnet/` | the page for the .NET edition's `gridanon ui` | `npm run build:dotnet-ui` (maintainers, see below) |

## Develop

```bash
npm run dev                                   # http://localhost:5173 with hot reload
npm run cli -- anonymize samples/psse -o out  # run the CLI straight from the .ts sources
npm run typecheck
npm test
npm start                                     # serve dist/ with server.mjs on :8080
```

Rules for `src/core`: erasable TypeScript only (no enums or parameter properties) so it runs directly under `node --experimental-strip-types`; `.ts` import extensions; no DOM or Node APIs (I/O goes through `ByteSource`/`OutputTarget`).

## The .NET edition's UI (maintainers)

The .NET edition's `gridanon ui` serves this same page, built in `dotnet` mode: no in-browser engine, talks to the local .NET server instead. The .NET edition commits that build so it doesn't need Node:

```bash
npm run build:dotnet-ui -- <path-to-dotnet-edition-folder>    # default: ../dotnet
```

Commit the changed `src/GridAnonymizer.Cli/wwwroot/` in the .NET edition.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node: bad option: --experimental-strip-types` | Node is older than 22.6: upgrade. |
| `npm ci` fails with a lockfile error | Use npm 10+ (comes with Node 22), or run `npm install` once. |
| The offline page shows nothing | Rebuild with `npm run build`; `build:offline` must run after `build:web`. |
