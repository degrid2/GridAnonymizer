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

## Bus renumbering safety

Renumbering is opt-in because it changes every script, contingency file and dynamics file that names a bus. Pass those files in the same run, or rewrite them later with `--use-mapping`. For PSS®E `.dyr` files, bus-number rewriting is on the roadmap.

`gridanon` refuses to renumber when the file contains records whose bus fields it cannot locate with confidence (multi-terminal DC, GNE, multi-terminal substation equipment) or has unlabeled section terminators. A partly renumbered model would be silently wrong, so it stops with an explanation instead. Names are still anonymized without `--renumber-buses`.

After rewriting, the audit re-parses the output and checks that every bus reference resolves and every bus number is unique.

## Encoding

RAW files are read and written as Latin-1, so every byte round-trips unchanged even in files with mixed encodings.
