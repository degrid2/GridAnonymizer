# Profiles

A profile is JSON (comments and trailing commas allowed). Omitted fields keep the defaults. `gridanon profile init my.json` (Node CLI) or **Download this profile** on the page writes every field with its default value.

```jsonc
{
  "name": "my-utility",
  "preserveNames": ["^XNODE_"],          // regexes; matching names are never renamed (all formats)
  "redactTerms": ["Meridian Power"],     // must never survive; replaced with redactionText, hunted by the audit
  "redactionText": "REDACTED",
  "cim":  { ... },
  "psse": { ... },
  "text": { "minNameLength": 3 }
}
```

Regular expressions (`preserveNames`, `preserveIdPatterns`, `keepStringPatterns`) use JavaScript syntax. If the same profile is also used with the .NET edition, stick to the common subset: character classes, anchors, `\d \s \w`, quantifiers, groups and alternation, with no inline options like `(?i)`.

Command-line flags (Node CLI) and the page's checkboxes override the profile: `--renumber-buses`, `--keep-comments`, `--keep-titles`, `--redact` (adds to `redactTerms`).

## `cim`

| Field | Default | Meaning |
|---|---|---|
| `anonymizeIds` | `true` | remap `rdf:ID`/`rdf:about` and references |
| `anonymizeExternalReferences` | `true` | also remap ids referenced but not declared in any input (set `false` to keep boundary-set references) |
| `preserveIdPatterns` | `[]` | regexes; matching ids are kept |
| `anonymizeNames` | `true` | rename the properties in `nameProperties` |
| `anonymizeMrids` | `true` | replace `IdentifiedObject.mRID` with the new id |
| `anonymizeDescriptions` | `true` | replace the properties in `descriptionProperties` |
| `stripComments` | `true` | drop `<!-- -->` |
| `replaceHeaders` | `true` | apply `headerProperties` |
| `keepTypeHints` | `false` | keep `_CC`, `_GT`, `_HYDRO`, `_WIND`... suffixes on generator names |
| `vocabularyMinCount` | `20` | a label used by this many objects is kept |
| `sensitiveClasses` | Substation, regions, Line, ControlArea, organisations, generating units | names that other objects inherit |
| `numericNameClasses` | VoltageLevel, BaseVoltage | numeric names here are kV and kept |
| `classPrefixes` / `defaultPrefix` | `SUB`, `BKR`, `LN`, ... / `OBJ` | pseudonym prefixes |
| `nameProperties` | `IdentifiedObject.name` | add e.g. `IdentifiedObject.energyIdentCodeEic` |
| `descriptionProperties` | description, aliasName, shortName | |
| `headerProperties` | `md:Model.description`, `md:Model.modelingAuthoritySet` | replacement text; `{hash8}` expands to a keyed hash |
| `overwriteProperties` | PositionPoint x/y/z → `0`, street/town fields → empty | values replaced outright |

## `psse`

| Field | Default | Meaning |
|---|---|---|
| `anonymizeNames` | `true` | rename every quoted name field, and labels in `.con`/`.mon`/`.sub`/`.aux` files |
| `replaceCaseTitle` / `caseTitle` | `true` / `ANONYMIZED CASE` | the two title lines |
| `stripComments` | `true` | drop `/` comments (section labels such as `END OF BUS DATA` are kept) and anything after `Q`; in companion files, `COM` lines and `/` comments |
| `renumberBuses` | `false` | renumber buses in every referencing field, and in companion files of the same run |
| `busNumberStrategy` | `shuffled` | or `sequential` |
| `busNumberStart` | `1` | |
| `zeroCoordinates` | `true` | substation latitude/longitude (rev 34+) |
| `keepStringPatterns` | ids of 2 characters or fewer, vector groups | quoted strings that are data, not names (companion-file labels too) |
| `namePrefixes` | `bus: BUS`, `branch: BR`, `transformer: XF`, ... | keep them short, since PSS/E names are at most 12 characters |
