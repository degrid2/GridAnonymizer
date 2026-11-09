# Adding a format: .NET edition

1. Create `src/GridAnonymizer.Core/Formats/<Name>/<Name>Handler.cs` implementing `IFormatHandler`:
   - `Id`: the short name for `--format`
   - `Sniff(head)`: true when the first 16 KB look like your format
   - `CreateJob(context)`: return your `IFormatJob`
   - `Phase` (optional): `0` for a model (default), `1` for a file that follows a model in the same run and reads `context.Mapping` (like the PSS®E companion handler, `Formats/Psse/PsseAuxHandler.cs`), `2` for free text
2. Implement `IFormatJob`:
   - `Scan(path)`: inventory identifying values (called for every file before any rewrite)
   - `BuildMaps()`: create pseudonyms. Honour `context.Mapping` (continue a previous run) and `context.Restore` (invert it).
   - `Rewrite(in, out)`: stream the file, replace identity tokens only, count changes in `FileReport.Stats`
   - `Audit(original, output)`: hunt for the original values in the output
   - `ExportTo(mapping)`: add your pairs to the `MappingDocument` (add a section if needed)
3. Add options to `AnonymizationProfile` if customers need to tune it, and document them in `docs/profiles.md`.
4. Register the handler in `FormatRegistry.All`.
5. Add a fictional sample under `samples/` and tests: anonymize → audit clean → restore round trip.

Rules of thumb: never load a whole file into memory, keep everything that isn't identity byte for byte, and treat "I can't be sure" as an error, not a guess.
