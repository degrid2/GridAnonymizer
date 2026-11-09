# Run: TypeScript edition

## The page (hosted or offline: identical)

The page has three tabs.

Every option has a **?** next to it that explains what it does and when to use it, and **Help** in the header opens a one-page guide.

**Anonymize**
1. Drop model files onto the drop zone (`.xml`/`.rdf` CIM/CGMES, `.raw` PSS®E with its `.con`/`.mon`/`.sub`/`.aux` files, `.csv` results), or one `.zip` of them, or choose *Try the sample set*. Files from a zip show the zip's name and keep their folders. Each file shows its detected format, which you can change, or remove a file with ×.
   When PSS®E files are in the set, the **PSS®E set** panel shows which parts are there. Only the case is needed; *+ Contingencies .con* and the other chips add a missing part.
2. Pick a profile, and turn on *Renumber buses* or *Save mapping* if you need them.
3. Press **Anonymize**. The results replace the file list, with a verdict ("All 5 files are clean", or which file failed the audit) and a row per file with **Download**. *Details* shows what changed and what the audit checked. Use *Download all as …zip* (everything in one zip, original folders and names inside: `<zip>_anonymized.zip` for a dropped zip, else `gridanon_anonymized.zip`) and *Download mapping* below the list; *Back to files* to re-run with other options; *Start over* for a new set.

**Restore:** drop anonymized files (a vendor's CSV, a contingency list, the anonymized model), choose the mapping file, and press **Restore**.

**Settings:** everything else, remembered between visits (except the salt and redact terms, which are never stored):
- Profile, and *Download as JSON* to customize one.
- Salt, *Continue from mapping* (a new revision gets the same pseudonyms), *Save mapping*.
- Redact terms: one per line, never allowed to survive.
- PSS®E: renumber buses, keep case titles.
- Output: keep comments, keep plant-type hints, and (Chrome/Edge) save straight to a folder for very large models.

When a setting from the Settings tab changes the result, a line under the Anonymize button says so ("Also applied: keep comments. Change").

Files dropped together share one mapping, so a CGMES set or several cases of one system stay consistent.

## The Node CLI

```
node gridanon-node.mjs anonymize <files|dirs...> [options]
node gridanon-node.mjs restore   <files|dirs...> --mapping <file> [-o <dir>]
node gridanon-node.mjs audit     <original> <anonymized> [--format F] [--profile P] [--mapping M]
node gridanon-node.mjs profile   init [file]
node gridanon-node.mjs formats
node gridanon-node.mjs version
```

| Option (`anonymize`) | Meaning |
|---|---|
| `-o, --out <dir>` | output directory (default `./anonymized`); files are named `<name>_anonymized.<ext>` |
| `-p, --profile <file>` | JSON profile ([profiles.md](profiles.md)) |
| `--salt <text>` / `--salt-env <VAR>` | secret key; same salt means same output |
| `-m, --mapping <file>` | write the **private** mapping |
| `--use-mapping <file>` | continue an earlier mapping |
| `-f, --format <id>` | force `cim`, `psse`, `psse-aux` or `text` |
| `--zip <file>` | put every output into one zip; a `.zip` input always gives `<name>_anonymized.zip` with the same layout inside |
| `--renumber-buses` | PSS®E: renumber buses everywhere they are referenced |
| `--keep-comments` / `--keep-titles` | keep comments / PSS®E case titles |
| `--redact <term>` | must never survive (repeatable) |
| `--report <file>` | JSON report of the run |
| `--no-audit` | skip the audit (not recommended) |
| `-r, --recursive` | descend into directories |
| `-q, --quiet` | print only problems |

**Exit codes:** `0` clean · `1` error · `2` the audit found something identifying.

Examples:
```bash
node gridanon-node.mjs anonymize ./igm/ -o ./share -m ./private/igm_map.json                   # a CGMES set
node gridanon-node.mjs anonymize case.raw -p profiles/vendor-strict.json --redact "Meridian Power" -m private/map.json
node gridanon-node.mjs anonymize case_2027.raw --use-mapping private/map.json -m private/map_2027.json
node gridanon-node.mjs anonymize case.raw ctg.con mon.mon --renumber-buses -m private/map.json   # a PSS/E set
node gridanon-node.mjs anonymize study.zip -o share                                         # → share/study_anonymized.zip
node gridanon-node.mjs restore vendor_results.csv --mapping private/map.json
node gridanon-node.mjs audit case.raw anonymized/case_anonymized.raw
```
