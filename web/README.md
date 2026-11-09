# GridAnonymizer: TypeScript edition

**Anonymize CIM/CGMES and PSS®E RAW network models in your browser, then prove nothing identifying survived.**

The TypeScript edition comes in three forms, all built from this folder:

| Form | File | Needs | Best for |
|---|---|---|---|
| **Browser page** | hosted site (`dist/`) | a modern browser | everyday use; nothing to install |
| **Offline page** | `gridanon-web.html` (one ~100 KB file) | a modern browser | air-gapped machines: double-click, no server, no network |
| **Node CLI** | `gridanon-node.mjs` (one file) | Node.js 22+ | scripts and pipelines where Node is already installed |

Your files never leave your computer. The engine runs inside the browser tab (a Web Worker), and the page enforces `connect-src 'none'`, so the browser itself blocks any network request. There are no runtime dependencies: the page and CLI use only browser and Node built-ins.

Names, ids, descriptions, comments, coordinates and (optionally) PSS®E bus numbers get consistent pseudonyms. Impedances, ratings, topology and every other electrical value stay exactly as they were. Every output is re-read and audited for anything that got through. A PSS®E case can bring its `.con`, `.mon`, `.sub` and `.aux` files, loose or in one `.zip`; they follow the case, and a zip comes back as a zip.

## Five-minute start

**Browser:** open the hosted page, or double-click `gridanon-web.html` from Releases. Choose *Try the sample set*, then **Anonymize 5 files**: you get "All 5 files are clean" and a download per file.

**Node CLI:**
```bash
node gridanon-node.mjs anonymize samples/cim samples/psse --renumber-buses -m private/map.json
node gridanon-node.mjs restore anonymized/study_results_anonymized.csv --mapping private/map.json
```

**From source:** `npm ci && npm run dev`, then open http://localhost:5173.

## Documentation

| | |
|---|---|
| **[Install](docs/install.md)** | use the hosted page, the offline file or the Node CLI; verify checksums |
| **[Build](docs/build.md)** | build from source: the site, the offline page, the Node CLI |
| **[Run](docs/run.md)** | using the page step by step; every Node CLI command and option |
| **[Test](docs/test.md)** | automated tests, browser smoke test, manual walkthrough |
| **[Deploy](docs/deploy.md)** | host the page: GitHub Pages, Cloudflare/Netlify, Docker, Railway, any static server |
| [Profiles](docs/profiles.md) | per-customer rules in JSON |
| [CIM / CGMES](docs/formats/cim.md) · [PSS®E RAW](docs/formats/psse.md) | exactly what changes in each format |
| [Architecture](docs/architecture.md) · [Adding a format](docs/extending.md) · [Coming from v1](docs/migrating-from-v1.md) | for contributors and v1 users |

## What's in this folder

```
src/core/      the engine: cim, psse, text, profile, mapping, hash, engine (no DOM, no Node APIs)
src/app/       the page: main.ts (UI), worker.ts (runs the engine), backends, style.css
index.html     the page markup
cli/           the Node CLI
test/          node:test unit, golden (test/golden) and parity tests
scripts/       offline single-file build, browser smoke test, copy-to-dotnet
server.mjs     zero-dependency static server with the security headers
profiles/      ready-made profiles: vendor-strict, cgmes-boundary, names-only
samples/       fictional CIM, CGMES and PSS®E models
```

A **.NET edition** with the same engine also exists: a native command line, `gridanon ui` (this same page, run by the .NET engine), and a NuGet library. Output, mapping files and profiles are interchangeable between the two editions.

## License

[MIT](LICENSE). PSS®E is a trademark of Siemens. CGMES is published by ENTSO-E. This project is not affiliated with either.
