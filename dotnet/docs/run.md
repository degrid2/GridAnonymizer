# Run: .NET edition

`gridanon` has a browser UI and a command line. Both drive the same engine with the same options.

## The UI: `gridanon ui`

```bash
gridanon ui                     # opens http://localhost:<random port>/?t=<token>
gridanon ui -o D:\shared\out    # where results are written (default: .\gridanon-output)
gridanon ui --port 8765         # fixed port
gridanon ui --no-browser        # just print the URL
```

The page opens in your default browser. Every option has a **?** that explains it, and **Help** in the header opens a one-page guide. The page is the same as the TypeScript edition's, with three tabs:

- **Anonymize:** drop model files, or one `.zip` of them (or *Try the sample set*), pick a profile, optionally *Renumber buses* and *Save mapping*, then press **Anonymize**. The verdict and one row per file replace the file list. Results are written to the output folder and can also be downloaded. *Back to files* re-runs with other options; *Start over* begins a new set.
  When PSS®E files are in the set, a **PSS®E set** panel shows which parts are there (case, contingencies, monitored elements, subsystems, auxiliary) and adds a missing one in a click. Several files, or a zip, also come back as one zip (`<zip>_anonymized.zip`, or `gridanon_anonymized.zip`) with the original folders and names inside, written to the output folder and offered for download.
- **Restore:** drop anonymized files, choose the mapping, and press **Restore**.
- **Settings:** profile, salt, continue from a mapping, redact terms, PSS®E options, keep comments and type hints, and the output folder. When a setting changes the result, a line under the Anonymize button says so.

Stop the UI with **Ctrl+C** in its terminal. Uploaded copies of your inputs live in a private temp folder that is deleted when you choose a new set of files and when the UI stops. How it is kept safe: [ui.md](ui.md).

## The command line

```
gridanon anonymize <files|dirs...> [options]
gridanon restore   <files|dirs...> --mapping <file> [-o <dir>]
gridanon audit     <original> <anonymized> [--format F] [--profile P] [--mapping M]
gridanon ui        [-o <dir>] [--port N] [--no-browser]
gridanon profile   init [file]
gridanon formats
gridanon version
```

### `anonymize` options

| Option | Meaning |
|---|---|
| `-o, --out <dir>` | output directory (default `./anonymized`). Files are named `<name>_anonymized.<ext>`. |
| `-p, --profile <file>` | JSON profile ([profiles.md](profiles.md)) |
| `--salt <text>` | secret key for the pseudonyms. Same salt means same output. Without it, a random salt is generated and printed. |
| `--salt-env <VAR>` | read the salt from an environment variable (keeps it out of shell history) |
| `-m, --mapping <file>` | write the **private** mapping (reverses everything, so keep it safe) |
| `--use-mapping <file>` | continue an earlier mapping: a new revision gets the same pseudonyms |
| `-f, --format <id>` | force `cim`, `psse`, `psse-aux` or `text` instead of detecting |
| `--zip <file>` | put every output into one zip. A `.zip` input always gives `<name>_anonymized.zip` with the same layout and the original file names inside |
| `--renumber-buses` | PSS®E: renumber buses in every field that references one |
| `--keep-comments` | keep XML `<!-- -->` and RAW `/` comments |
| `--keep-titles` | PSS®E: keep the two case-title lines |
| `--redact <term>` | a term that must never survive (repeatable), e.g. your company name |
| `--report <file>` | write a JSON report of the run |
| `--no-audit` | skip the leak audit (not recommended) |
| `-r, --recursive` | descend into directories |
| `-q, --quiet` | print only problems |

**Exit codes:** `0` clean · `1` error · `2` the audit found something identifying.

### Typical workflows

```bash
# A whole CGMES set: one run, so references between EQ/SSH/TP/SV stay consistent
gridanon anonymize .\igm\ -o .\share -m .\private\igm_map.json

# A PSS/E case for a vendor
gridanon anonymize case.raw -p profiles\vendor-strict.json --redact "Meridian Power" --redact MPL -m private\map.json

# Next revision: same pseudonyms for unchanged equipment, new ones for new equipment
gridanon anonymize case_2027.raw --use-mapping private\map.json -m private\map_2027.json

# A PSS/E set: the .con/.mon/.sub files follow the case (bus numbers, names, labels)
gridanon anonymize case.raw contingencies.con monitored.mon areas.sub --renumber-buses -m private\map.json

# The same set as one zip: back comes share\study_anonymized.zip, same layout inside
gridanon anonymize study.zip --renumber-buses -o share -m private\map.json

# Loose files, delivered as one zip
gridanon anonymize case.raw contingencies.con --zip share\for_vendor.zip

# Results back from the vendor
gridanon restore vendor_results.csv --mapping private\map.json -o restored

# Double-check a file before it goes out
gridanon audit case.raw anonymized\case_anonymized.raw
```

In CI, use `--salt-env` and the exit code:
```bash
gridanon anonymize model/ -o out --salt-env GRIDANON_SALT -q || exit 1
```

## Using the library

```csharp
using GridAnonymizer.Engine;
using GridAnonymizer.Profiles;

var profile = ProfileLoader.Load("profiles/vendor-strict.json");      // or new AnonymizationProfile()
var engine = new AnonymizerEngine(new EngineOptions { Profile = profile, Salt = Environment.GetEnvironmentVariable("GRIDANON_SALT") });

var inputs = new[] { "EQ.xml", "SSH.xml" }.Select(p => new InputFile(p, FormatRegistry.Detect(p)!)).ToList();
var result = engine.Anonymize(inputs, outputDirectory: "out");

result.Mapping.Save("private/map.json");
foreach (var f in result.Report.Files)
    Console.WriteLine($"{f.Input}: {(f.Audit!.Clean ? "clean" : "LEAK")}");
```

`engine.Restore(...)` and `engine.Audit(original, anonymized, format)` work the same way.
