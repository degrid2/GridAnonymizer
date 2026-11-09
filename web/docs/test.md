# Test: TypeScript edition

## Automated tests

From this folder, after `npm ci`:

```bash
npm run typecheck
npm test                 # unit + golden tests (node:test, runs the .ts sources directly)
npm run build
npx playwright install chromium   # once
npm run test:browser     # headless browser smoke test
```

| Test | What it proves |
|---|---|
| `test/core.test.ts` | CIM output byte-identical to the original v1 tool (`test/golden`); chunk boundaries; multi-profile CGMES sets; refusing CDATA and single-quoted attributes; PSS®E names, titles, comments and renumbering; refusing unsafe renumbering; restore round trips; line endings; profiles and mappings load |
| `test/bundle.test.ts` | PSS®E companion files follow the case (renumbering, bus ranges, labels, restore, warnings); zip reader and writer (normalized names, zip slip refused, round trip, corruption detected); CLI `.zip` input and `--zip` |
| `test/parity.test.ts` | identical bytes and mappings to the .NET edition across 6 configurations, and identical entries for a zipped PSS®E set. Runs only when `GRIDANON_DOTNET` points at a .NET `gridanon` binary; skipped otherwise |
| `scripts/browser-smoke.mjs` | opens the offline page from `file://` and the hosted page from `server.mjs` in headless Chromium, runs every sample, checks all audits pass, compares each download with the CLI byte for byte, restores through the UI, drops a zipped PSS®E set and checks the set panel and the returned zip, and asserts **no network request** after load. With `GRIDANON_DOTNET` set, it also tests the .NET edition's `gridanon ui` |

Optional cross-check against the .NET edition:
```bash
GRIDANON_DOTNET=/path/to/gridanon npm run test:parity        # PowerShell: $env:GRIDANON_DOTNET="C:\...\gridanon.exe"
```

## Manual walkthrough (about 5 minutes)

### Page

1. `npm run build`, then double-click `dist/gridanon-web.html` (or open the hosted page).
2. Open developer tools → **Network**.
3. **Settings** tab: type `Meridian` under *Terms that must not survive*.
4. **Anonymize** tab: choose *Try the sample set*, turn on *Renumber buses* and *Save mapping*, and press **Anonymize 8 files**. The **PSS®E set** panel above shows Case ×2, Contingencies, Monitored elements and Subsystems.
5. Expect "All 8 files are clean", eight rows with green dots, *Download all as gridanon_anonymized.zip*, and no new entries in the Network tab.
6. Download `meridian_v33_anonymized.raw` and check: names are `BUS_0001…` at the same width, the title is `ANONYMIZED CASE`, `'YNd1'` is kept, and buses are renumbered 1–7 with generator `IREG`, transformer `CONT` and switched-shunt `SWREM` following.
7. Press **Download mapping**, then **Start over**. On the **Restore** tab, drop the downloaded `study_results_anonymized.csv`, choose the mapping, and press **Restore**. The result is the original CSV.
8. To see the audit catch a leak: in **Settings**, clear the redact term and turn on *Keep comments*, then anonymize `samples/psse/meridian_v33.raw`. You get "The file failed the audit" and *Details* lists "Names: Meridian".

### Node CLI

```bash
node dist-cli/gridanon.mjs anonymize samples/cim samples/psse --renumber-buses --redact Meridian -o out -m out/map.json
echo $?    # 0
node dist-cli/gridanon.mjs anonymize samples/psse/meridian_v33.raw --keep-comments -o out2
echo $?    # 2: the kept comment "Meridian downtown feeders" names the owner; the audit catches it
node dist-cli/gridanon.mjs restore out/study_results_anonymized.csv --mapping out/map.json -o back
diff samples/psse/study_results.csv back/study_results_anonymized_restored.csv && echo identical
```

## Testing with your own models

Run the CLI with `-m map.json --report report.json` and keep the exit code. Open the result in your normal tool and solve a power flow: it matches the original apart from names and numbers. Never attach real models to bug reports.
