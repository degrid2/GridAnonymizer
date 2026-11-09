# PSS®E RAW

Supports power-flow RAW revisions 30–35. The revision is read from the case identification line. Where layouts differ between revisions, the field count of the record decides, which keeps working when the revision number is missing or wrong.

## Sections

Section boundaries come from the `0 / END OF X DATA, BEGIN Y DATA` labels that PSS®E writes. Files without labels fall back to the documented section order for their revision (names are still anonymized; bus renumbering is refused).

| Section | Names | Bus-reference fields renumbered |
|---|---|---|
| Case identification | titles replaced, comment replaced | – |
| System-wide (rev 35) | kept verbatim | – |
| Bus | NAME | I |
| Load, Fixed shunt, Induction machine | – (ids kept) | I |
| Generator | – | I, IREG |
| Branch, System switching device | NAME (rev 34+) | I, J |
| Transformer | NAME (vector group kept) | I, J, K, CONT1–3 |
| Area | ARNAME | ISW |
| Two-terminal DC | NAME | IPR/IPI, ICR/ICI, IFR, ITR |
| VSC DC | NAME | IBUS, REMOT/VSREG |
| Multi-section line | – | I, J, DUM1–9 |
| Zone, Owner | ZONAME, OWNAME | – |
| FACTS | NAME, MNAME | I, J, REMOT/FCREG |
| Switched shunt | RMIDNT (same mapping as the device it names) | I, SWREM/SWREG |
| Substation (rev 34+) | substation, node, switching-device names; coordinates zeroed | node bus |
| Multi-terminal DC, GNE | names | *renumbering refused* |

Negative bus numbers (such as a negative `CONT` for reversed control) keep their sign. Number fields are re-padded to their original width so column alignment survives.

## Companion files: `.con`, `.mon`, `.sub`, `.aux`

A study is often a case plus contingencies (`.con`), monitored elements (`.mon`), subsystems (`.sub`) and other auxiliary files. Only the case is needed; the others are optional. Anonymize them **in the same run** as the case (as separate files, or inside one `.zip`) and they follow it: they run after the case and reuse its mapping, so every bus number, bus name and label matches.

| In the file | What happens |
|---|---|
| `BUS 101` | the number is renumbered like the case (when `--renumber-buses` is on) |
| `BUSES 100 TO 200` | a range cannot survive renumbering, so it becomes one `BUS n` line per bus of the case in that range |
| `BUS 'NAME   345'` | an extended bus name: the name part follows the case, the kV part is kept |
| `'any other text'` | a label (contingency, subsystem, interface…), replaced with `CTG_0001`, `SUBSYS_0001`, `INTF_0001`, `JOIN_…`, `TIE_…`, `GROUP_…` or `LABEL_…` after the nearest keyword. Labels go into the mapping, so result CSVs that mention them are rewritten too |
| `COM …` | a comment line: removed by default, kept with `--keep-comments` |
| everything else | keywords, circuit and machine ids, MW, kV, areas, zones: kept |

The format id is `psse-aux`; files are recognised by extension. Names are padded to their original width, so column layouts survive.

Warnings tell you when a companion file names a bus that is not in the case (it is left as it was), and when renumbering is on but no case was renumbered in the run (add the `.raw`). The audit checks the labels, the bus names and that no new dangling bus references appeared.

## Zip bundles

A `.zip` input is opened, every file inside is anonymized in the same run, and the results come back as `<name>_anonymized.zip` with the same folders and the **original file names** inside, ready to hand on. `--zip <file>` puts every output of a run, zipped or not, into one archive. Folder entries, `__MACOSX/`, `.DS_Store` and `._*` files are skipped; entries with absolute paths or `..` are refused. Extracted copies live in a private temp folder that is deleted when the run ends. ZIP64 (archives over 4 GB) and encrypted zips are not supported.

The page does the same: drop a zip (or several files) and download everything as one zip.

## Bus renumbering safety

Renumbering is opt-in because it changes every script, contingency file and dynamics file that names a bus. Pass `.con`, `.mon`, `.sub` and `.aux` files in the same run (see above), or rewrite them later with `--use-mapping`. For PSS®E `.dyr` files, bus-number rewriting is on the roadmap.

`gridanon` refuses to renumber when the file contains records whose bus fields it cannot locate with confidence (multi-terminal DC, GNE, multi-terminal substation equipment) or has unlabeled section terminators. A partly renumbered model would be silently wrong, so it stops with an explanation instead. Names are still anonymized without `--renumber-buses`.

After rewriting, the audit re-parses the output and checks that every bus reference resolves and every bus number is unique.

## Encoding

RAW files are read and written as Latin-1, so every byte round-trips unchanged even in files with mixed encodings.
