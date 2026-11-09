# Test: .NET edition

## Automated tests

From this folder:

```bash
dotnet test                         # 57 tests
dotnet format --verify-no-changes   # style; CI enforces it (warnings are errors)
```

| Area | Tests |
|---|---|
| CIM | byte-identical to the original v1 tool (`tests/golden`), chunk boundaries, multi-profile CGMES sets, boundary-set references, coordinates, redact terms, refusing CDATA and single-quoted attributes, restore round trip, mapping continuation, id shapes |
| PSS®E | v33 and v35 names, titles and comments; renumbering in every bus-reference field; shuffled vs sequential; substation coordinates; two cases of one system; refusing unsafe renumbering; restore round trip; preserve patterns; tokenizer; line endings |
| PSS®E companions | `.con`/`.mon`/`.sub` follow the renumbered case; bus ranges expanded; labels consistent and reaching result CSVs; restore; missing-bus and missing-case warnings |
| Zip | entry names normalized; zip slip refused; extract and write round trip |
| Text | companion CSV gets the same pseudonyms and restores exactly |
| UI server | serves the embedded page with a loopback-only CSP; refuses a missing token, a foreign `Origin` and a foreign `Host`; upload → detect → run → download returns exactly the engine's output; a zipped set keeps its layout and comes back as one zip; paths cannot escape the output folder |

## Test the native binary

```bash
dotnet publish src/GridAnonymizer.Cli -c Release -r win-x64 -o out      # your runtime id
.\out\gridanon anonymize samples\cim samples\psse --renumber-buses --salt t -o anon -m anon\map.json
.\out\gridanon restore anon\study_results_anonymized.csv --mapping anon\map.json -o back
fc samples\psse\study_results.csv back\study_results_anonymized_restored.csv    # Windows; Linux/macOS: diff
```

Expect eight `audit: clean` lines, exit code `0`, and "no differences" from `fc`/`diff`.

## Manual walkthrough (about 5 minutes)

### Command line

```bash
gridanon anonymize samples\cim samples\psse --renumber-buses --redact Meridian -o out -m out\map.json
```

Open the files in `out\` and check:

| Check | File | Expect |
|---|---|---|
| CIM names renamed, structure kept | `sample-network_anonymized.xml` | `NORTHWIND` → `SUB_000n`, its feeder `NORTHWIND_FDR12` → `SUB_000n_L0001`; `345` and `MW` unchanged |
| CGMES ids keep their shape | `cgmes_eq_uuid_anonymized.xml` | valid v4 UUIDs; `mRID` = new `rdf:ID` without `_`; header `Anonymized CIM model` |
| PSS®E names and titles | `meridian_v33_anonymized.raw` | `'NORTHWIND   '` → `'BUS_0001    '` (same width); title `ANONYMIZED CASE`; `'YNd1'` kept |
| PSS®E renumbering | same | buses 1–7; generator `IREG`, transformer `CONT` (also the negative one) and switched-shunt `SWREM` follow |
| v35 extras | `meridian_v35_anonymized.raw` | `RATING` lines untouched; substation latitude/longitude `0.0000` |
| Companion CSV | `study_results_anonymized.csv` | `NW-RB 345 L1` → `BR_0001`, `RIVERBEND` → `BUS_0002` |

**The audit catches leaks:**
```bash
gridanon anonymize samples\psse\meridian_v33.raw --keep-comments -o out2
echo %ERRORLEVEL%      # PowerShell: $LASTEXITCODE; bash: $?  → 2, "names: Meridian"
```
The kept comment "Meridian downtown feeders" names the owner. Add `--redact Meridian` and the same run passes.

### UI

1. `gridanon ui -o out-ui`
2. **Settings:** type `Meridian` under *Terms that must not survive*.
3. **Anonymize:** *Try the sample set*, turn on *Renumber buses* and *Save mapping*, and press **Anonymize 8 files**. Expect "All 8 files are clean", with the files in `out-ui\`, and *Download all as gridanon_anonymized.zip* below the list. The **PSS®E set** panel shows Case ×2, Contingencies, Monitored elements and Subsystems.
4. **Download mapping**, then **Start over**. **Restore:** drop `out-ui\study_results_anonymized.csv`, choose the mapping, and press **Restore**. The result is the original CSV.

## Testing with your own models

1. `gridanon anonymize <model> -m map.json --report report.json`. Keep the exit code.
2. Open the result in your normal tool (PSS®E, PowerFactory, a CGMES validator) and solve a power flow. Electrical data is unchanged, so results match the original apart from names and numbers.
3. Never attach real models to bug reports. Reproduce with a few hand-written records like `samples/`.
