# Architecture: .NET edition

```
GridAnonymizer.Cli (gridanon)          GridAnonymizer.Core
  Program.cs   commands, options  ──►   Engine/AnonymizerEngine   grouping, passes, audit, mapping
  Ui/UiServer  `gridanon ui`      ──►   Formats/Cim  Formats/Psse (RAW + companions)  Formats/Text   (IFormatHandler / IFormatJob)
  wwwroot/     the page                 Profiles/  Mapping/  Hashing/  IO/XmlChunker  IO/ZipBundle
```

## A run

0. **Unpack (CLI).** A `.zip` input is extracted to a private temp folder (`ZipBundle`, zip-slip safe); each entry remembers its folder (`InputFile.RelativeDirectory`), and the temp folder is deleted when the run ends.
1. **Detect.** `FormatRegistry.Detect` sniffs the first 16 KB, then falls back to the file extension.
2. **Group.** Inputs are grouped by format, and groups run in phases (`IFormatHandler.Phase`): **0** models (CIM, PSS®E RAW), **1** PSS®E companion files (`.con .mon .sub .aux`), **2** `text`. Phases above 0 see the mapping built so far, so companion files follow the case's bus numbers and names, and CSVs and reports reuse every name and label just mapped.
3. **Scan (pass 1).** Every file in a group is scanned before any is rewritten. The inventory holds ids, names, references and vocabulary, never the file itself.
4. **Build maps.** One mapping per group, so a CGMES EQ/SSH/TP/SV set or several RAW cases of one system stay consistent. `--use-mapping` seeds it.
5. **Rewrite (pass 2).** Files stream through. Only identity tokens are replaced; everything else, whitespace included, is copied byte for byte. Output goes to a temporary file that is renamed at the end, so a failed run never leaves a half-written model.
6. **Audit.** Each output is re-read and checked against the original's inventory.
7. **Export.** The mapping is written only if `-m` was given.
8. **Package (CLI).** Outputs of a zip input are packed into `<name>_anonymized.zip` with the original folders and file names; `--zip` packs everything into one archive.

## Pseudonyms

| Thing | Rule |
|---|---|
| CIM ids | `HMAC-SHA256(salt, "id " + id)` with the shape kept: UUID → v4-shaped UUID, `_123` → `_NNNNNNNNNN`, `urn:uuid:` kept |
| CIM names | sequential per class prefix (`SUB_0001`). Objects named after a sensitive object borrow its pseudonym (`SUB_0001_B0003`) and keep short suffixes (`_BB`, circuit numbers). |
| CIM mRIDs | the object's new id without its leading `_` |
| CIM descriptions | the matching name pseudonym, otherwise `DESC_` + 6 hex characters |
| PSS®E names | sequential per section prefix (`BUS_0001`, `XF_0002`), padded to the original field width |
| PSS®E buses | `sequential` (file order) or `shuffled` (ordered by HMAC of the old number) |
| PSS®E companion labels | sequential per keyword (`CTG_0001`, `SUBSYS_0001`, `INTF_0001`…), stored with the names so result CSVs follow |

Vocabulary is kept: kV names, labels shared by `vocabularyMinCount` or more objects, `...Type`/`...Kind` values, enumeration literals, class names, and anything matching `preserveNames`.

## Audit

- **Names:** every original name of 4+ characters containing a letter that wasn't kept as vocabulary, whole and as a token inside longer values.
- **Ids:** every original `rdf:ID`/`rdf:about` value.
- **Redact terms:** case-insensitively, anywhere in text content.
- **PSS®E integrity:** every bus-reference field resolves, and bus numbers are unique. In companion files: no bus reference that resolved before points nowhere after.

## Design choices

- **Streaming token replacement, not an XML DOM.** It preserves every byte that isn't identity, keeps memory flat on multi-GB models, and matches v1's output exactly. `XmlChunker` guarantees no rule can match across a chunk boundary.
- **Refuse rather than guess.** Constructs the rules can't see into (CDATA, single-quoted RDF attributes) and PSS®E records whose bus fields can't be located with confidence (GNE, multi-terminal DC) stop the run with an explanation.
- **AOT-safe.** No reflection-based serialization (`GridAnonymizerJsonContext`, `UiJsonContext`), no dynamic code: the CLI publishes as a single native executable.
- **Compatibility.** The TypeScript edition implements the same engine and produces identical bytes. If you change behaviour here, the same change belongs there.
