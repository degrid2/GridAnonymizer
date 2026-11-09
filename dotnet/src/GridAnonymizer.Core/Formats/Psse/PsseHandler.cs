using System.Text;
using System.Text.RegularExpressions;
using GridAnonymizer.Engine;
using GridAnonymizer.Hashing;
using GridAnonymizer.Mapping;

namespace GridAnonymizer.Formats.Psse;

/// <summary>Siemens PTI PSS/E power-flow RAW files, revisions 30-35.</summary>
public sealed class PsseHandler : IFormatHandler
{
    public string Id => "psse";
    public string Description => "PSS/E power-flow RAW (rev 30-35): names, titles, comments, optional bus renumbering";
    public IReadOnlyList<string> Extensions { get; } = [".raw"];

    public bool Sniff(string head)
    {
        using var r = new StringReader(head);
        string? line;
        while ((line = r.ReadLine()) is not null && line.StartsWith("@!", StringComparison.Ordinal)) { }
        if (line is null) return false;
        var t = PsseRaw.Tokenize(line, out _);
        return t.Count >= 2 && PsseRaw.TryInt(line, t[0], out var ic) && ic is 0 or 1 &&
               double.TryParse(t[1].Text(line), System.Globalization.CultureInfo.InvariantCulture, out _) &&
               head.Contains("END OF BUS DATA", StringComparison.OrdinalIgnoreCase);
    }

    public IFormatJob CreateJob(JobContext context) => new PsseJob(context);
}

internal sealed partial class PsseJob : IFormatJob
{
    // RAW files are frequently Latin-1 and occasionally contain stray bytes; a
    // single-byte encoding round-trips every byte unchanged.
    private static readonly Encoding RawEncoding = Encoding.Latin1;

    private readonly JobContext _ctx;
    private readonly GlobalRules _rules;
    private readonly Regex[] _keep;

    // pass-1 state shared across all files of the run
    private readonly List<(string Name, string Section)> _names = [];
    private readonly HashSet<string> _nameSeen = new(StringComparer.Ordinal);
    private readonly List<int> _buses = [];
    private readonly HashSet<int> _busSeen = [];
    private readonly Dictionary<string, FileInventory> _perFile = new(StringComparer.Ordinal);
    private readonly List<string> _renumberBlockers = [];

    private Dictionary<string, string> _nameMap = new(StringComparer.Ordinal);
    private Dictionary<int, int> _busMap = [];
    private readonly HashSet<string> _preserved = new(StringComparer.Ordinal);
    private bool _renumber;

    private sealed class FileInventory
    {
        public HashSet<string> Names { get; } = new(StringComparer.Ordinal);
        public int Version { get; set; }
        public int DanglingRefs { get; set; }
    }

    public PsseJob(JobContext ctx)
    {
        _ctx = ctx;
        _rules = new GlobalRules(ctx.Profile);
        _keep = [.. ctx.Profile.Psse.KeepStringPatterns.Select(p => new Regex(p, RegexOptions.CultureInvariant))];
    }

    // ── which fields mean what ────────────────────────────────────────────────

    /// <summary>Is this quoted field a name to anonymize?</summary>
    private bool IsNameField(RawLine l, int index, string inner)
    {
        if (l.Section is PsseSection.SystemWide or PsseSection.CaseId) return false;
        if (l.Section == PsseSection.Gne && l.RecordLine == 0 && index == 1) return false;            // 'MODEL'
        if (l.Section == PsseSection.Substation && l.SubBlock == 3 && index == 2) return false;         // equipment type
        if (inner.Trim().Length == 0) return false;
        return !Array.Exists(_keep, r => r.IsMatch(inner));
    }

    /// <summary>
    /// Field positions holding bus numbers, per section and record line. Verified
    /// against the PSS/E 33-35 program operation manuals; where layouts differ by
    /// revision the record's field count decides, which is robust to the
    /// revision number being wrong or missing.
    /// </summary>
    internal static IEnumerable<int> BusFields(RawLine l)
    {
        var n = l.Tokens.Count;
        switch (l.Section)
        {
            case PsseSection.Bus or PsseSection.Load or PsseSection.FixedShunt or PsseSection.InductionMachine:
                yield return 0; break;
            case PsseSection.Generator:
                yield return 0; yield return 7; break;                                  // I, IREG
            case PsseSection.Branch or PsseSection.SwitchingDevice:
                yield return 0; yield return 1; break;                                  // I, J
            case PsseSection.Transformer:
                if (l.RecordLine == 0) { yield return 0; yield return 1; yield return 2; } // I, J, K
                else if (l.RecordLine >= 2 && n >= 15) yield return n >= 25 ? 16 : 7;       // CONTn (rev34+ has 12 ratings)
                break;
            case PsseSection.Area:
                yield return 1; break;                                                  // ISW
            case PsseSection.TwoTerminalDc when l.RecordLine >= 1:
                yield return 0; yield return 12;                                        // IPR/IPI, ICR/ICI
                if (n >= 18) { yield return 14; yield return 15; }                      // rev35: NDR shifts IFR, ITR
                else { yield return 13; yield return 14; }
                break;
            case PsseSection.VscDc when l.RecordLine >= 1:
                yield return 0; yield return 13; break;                                 // IBUS, REMOT/VSREG
            case PsseSection.MultiSectionLine:
                yield return 0; yield return 1;
                for (var i = 4; i < n; i++) yield return i;                             // DUM1..DUM9
                break;
            case PsseSection.Facts:
                yield return 1; yield return 2; yield return 19; break;                 // I, J, REMOT/FCREG
            case PsseSection.SwitchedShunt:
                yield return 0;
                yield return n > 1 && l.Tokens[1].Quoted ? 7 : 6;                       // SWREM/SWREG (rev35 adds ID)
                break;
            case PsseSection.Substation when l.SubBlock == 1:
                yield return 2; break;                                                  // node's bus
            case PsseSection.Substation when l.SubBlock == 3:
                yield return 0; break;
        }
    }

    /// <summary>Records whose bus references we cannot locate with confidence.</summary>
    private static string? RenumberBlocker(RawLine l) => l.Section switch
    {
        PsseSection.MultiTerminalDc => "multi-terminal DC data",
        PsseSection.Gne => "GNE device data",
        PsseSection.Substation when l.SubBlock == 3 && l.Tokens.Count > 2 &&
            l.Tokens[2].Inner(l.Text).Trim() is "B" or "2" or "3" => "substation equipment terminals of branches/transformers",
        _ => null,
    };

    // ── pass 1 ────────────────────────────────────────────────────────────────

    public void Scan(string path)
    {
        var inv = new FileInventory();
        var walker = new RawWalker();
        var busRefs = new List<int>();
        var buses = new HashSet<int>();
        using (var reader = FileUtil.OpenText(path, RawEncoding))
        {
            foreach (var l in walker.Walk(reader))
            {
                if (l.Kind != LineKind.Data) continue;
                for (var i = 0; i < l.Tokens.Count; i++)
                {
                    var t = l.Tokens[i];
                    if (!t.Quoted) continue;
                    var inner = t.Inner(l.Text);
                    if (!IsNameField(l, i, inner)) continue;
                    var key = inner.Trim();
                    inv.Names.Add(key);
                    if (_nameSeen.Add(key)) _names.Add((key, l.SectionKey));
                }

                if (l.Section == PsseSection.Bus && l.Tokens.Count > 0 && PsseRaw.TryInt(l.Text, l.Tokens[0], out var bus))
                {
                    buses.Add(bus);
                    if (_busSeen.Add(bus)) _buses.Add(bus);
                }
                else
                {
                    foreach (var f in BusFields(l))
                        if (f < l.Tokens.Count && PsseRaw.TryInt(l.Text, l.Tokens[f], out var r) && r != 0) busRefs.Add(Math.Abs(r));
                }

                if (RenumberBlocker(l) is { } why && !_renumberBlockers.Contains(why)) _renumberBlockers.Add(why);
            }
        }
        inv.Version = walker.Version;
        inv.DanglingRefs = busRefs.Count(b => !buses.Contains(b));
        _perFile[Path.GetFullPath(path)] = inv;

        if (_ctx.Profile.Psse.RenumberBuses && !_ctx.Restore && !walker.SawLabels && walker.SawUnlabeledTerminator)
            _renumberBlockers.Add("unlabeled section terminators (expected '0 / END OF X DATA, BEGIN Y DATA')");
    }

    public void BuildMaps()
    {
        var o = _ctx.Profile.Psse;
        var preloaded = _ctx.Mapping?.Psse;

        if (_ctx.Restore)
        {
            if (preloaded is null) throw new InvalidOperationException("restore needs a mapping");
            foreach (var (k, v) in preloaded.Names) if (k != v) _nameMap.TryAdd(v, k);
            foreach (var (k, v) in preloaded.Buses) if (int.TryParse(k, out var orig)) _busMap.TryAdd(v, orig);
            _renumber = _busMap.Count > 0;
            return;
        }

        if (preloaded is not null)
            foreach (var (k, v) in preloaded.Names) _nameMap[k] = v;

        if (o.AnonymizeNames)
        {
            var counter = new NameCounter(_nameMap.Values);
            foreach (var (name, section) in _names)
            {
                if (_nameMap.ContainsKey(name)) continue;
                if (_rules.IsPreserved(name)) { _nameMap[name] = name; _preserved.Add(name); continue; }
                var prefix = o.NamePrefixes.GetValueOrDefault(section) ?? o.NamePrefixes.GetValueOrDefault("default") ?? "NAME";
                _nameMap[name] = counter.NextName(prefix);
            }
        }

        _renumber = o.RenumberBuses;
        if (_renumber)
        {
            if (_renumberBlockers.Count > 0)
                throw new NotSupportedException(
                    "Bus renumbering is not safe for this file: it contains " + string.Join("; ", _renumberBlockers) +
                    ". Run without --renumber-buses (names are still anonymized), or open an issue with a sample.");

            if (preloaded is not null)
                foreach (var (k, v) in preloaded.Buses) if (int.TryParse(k, out var orig)) _busMap[orig] = v;

            var used = new HashSet<int>(_busMap.Values);
            var fresh = _buses.Where(b => !_busMap.ContainsKey(b));
            if (o.BusNumberStrategy.Equals("shuffled", StringComparison.OrdinalIgnoreCase))
                fresh = fresh.OrderBy(b => Pseudonym.HexDigest(_ctx.Salt, "bus " + b, 16), StringComparer.Ordinal);
            var next = Math.Max(1, o.BusNumberStart);
            foreach (var b in fresh)
            {
                while (used.Contains(next)) next++;
                if (next > 999_997) throw new InvalidOperationException("Ran out of bus numbers (PSS/E maximum is 999997)");
                _busMap[b] = next;
                used.Add(next++);
            }
        }
    }

    // ── pass 2 ────────────────────────────────────────────────────────────────

    [GeneratedRegex(@"^\s*END OF .*DATA", RegexOptions.IgnoreCase)]
    private static partial Regex SectionLabel();

    public FileReport Rewrite(string inputPath, string outputPath)
    {
        var o = _ctx.Profile.Psse;
        var restore = _ctx.Restore;
        var report = new FileReport { Input = inputPath, Output = outputPath, Format = "psse", BytesIn = FileUtil.Size(inputPath) };
        var walker = new RawWalker();
        var unmappedSamples = new List<int>();

        var newLine = FileUtil.DetectNewLine(inputPath);
        FileUtil.WriteAtomically(outputPath, RawEncoding, writer =>
        {
            writer.NewLine = newLine;
            using var reader = FileUtil.OpenText(inputPath, RawEncoding);
            foreach (var l in walker.Walk(reader))
            {
                var line = RewriteLine(l, report, unmappedSamples, walker, o, restore);
                if (line is not null) writer.WriteLine(line);
            }
        });

        if (!walker.VersionFromFile) report.Warnings.Add("No revision number on the case identification line; assumed rev 33 layouts.");
        report.Stats["revision"] = walker.Version;
        if (unmappedSamples.Count > 0)
            report.Warnings.Add($"Bus references to buses not in this file were left unchanged, e.g. {string.Join(", ", unmappedSamples)}.");
        report.BytesOut = FileUtil.Size(outputPath);
        return report;
    }

    private string? RewriteLine(RawLine l, FileReport report, List<int> unmapped, RawWalker walker,
        Profiles.PsseOptions o, bool restore)
    {
        switch (l.Kind)
        {
            case LineKind.Passthrough:
            case LineKind.End:
                return l.Text;

            case LineKind.Trailer:
                if (restore || !o.StripComments) return l.Text;
                report.Count("trailerLinesDropped");
                return null;

            case LineKind.Title:
                if (restore || !o.ReplaceCaseTitle) return restore ? l.Text : _rules.Redact(l.Text, report);
                report.Count("titles");
                return l.TitleIndex == 1 ? o.CaseTitle : "";

            case LineKind.CaseId:
                if (restore || !o.StripComments || l.CommentStart < 0) return l.Text;
                report.Count("comments");
                return l.Text[..l.CommentStart].TrimEnd() + $"     / PSS(R)E-{walker.Version} RAW (anonymized)";

            case LineKind.Terminator:
                if (restore || !o.StripComments || l.CommentStart < 0) return l.Text;
                if (SectionLabel().IsMatch(l.Comment)) return l.Text;
                report.Count("comments");
                return l.Text[..l.CommentStart].TrimEnd();
        }

        // Data record.
        var edits = new List<(int Start, int Length, string Text)>();
        var text = l.Text;

        if (l.Section != PsseSection.SystemWide)
        {
            for (var i = 0; i < l.Tokens.Count; i++)
            {
                var t = l.Tokens[i];
                if (!t.Quoted) continue;
                var inner = t.Inner(text);
                var key = inner.Trim();
                string? replacement = null;
                if ((restore || IsNameField(l, i, inner)) && _nameMap.TryGetValue(key, out var mapped) && mapped != key)
                {
                    replacement = mapped.Length < inner.Length ? mapped.PadRight(inner.Length) : mapped;
                    report.Count("names");
                }
                else if (!restore && _rules.HasRedactions)
                {
                    var red = _rules.Redact(inner, report);
                    if (red != inner) replacement = red;
                }
                if (replacement is not null)
                    edits.Add((t.Start + 1, t.Length - 2, replacement));
            }
        }

        if (_renumber)
        {
            var fields = l.Section == PsseSection.Bus ? [0] : BusFields(l);
            foreach (var f in fields)
            {
                if (f >= l.Tokens.Count) continue;
                var t = l.Tokens[f];
                if (!PsseRaw.TryInt(text, t, out var value) || value == 0) continue;
                if (_busMap.TryGetValue(Math.Abs(value), out var nb))
                {
                    var s = (value < 0 ? "-" : "") + nb;
                    edits.Add((t.Start, t.Length, s.PadLeft(t.Length)));
                    report.Count("busNumbers");
                }
                else
                {
                    report.Count("unmappedBusRefs");
                    if (unmapped.Count < 5 && !unmapped.Contains(value)) unmapped.Add(value);
                }
            }
        }

        if (!restore && o.ZeroCoordinates && l.Section == PsseSection.Substation && l.SubBlock == 0 && l.RecordLine == 0)
        {
            foreach (var f in new[] { 2, 3 })
            {
                if (f >= l.Tokens.Count || l.Tokens[f].Quoted || l.Tokens[f].IsEmpty) continue;
                edits.Add((l.Tokens[f].Start, l.Tokens[f].Length, "0.0000".PadLeft(l.Tokens[f].Length)));
                report.Count("coordinates");
            }
        }

        var body = l.CommentStart >= 0 ? text[..l.CommentStart] : text;
        var sb = new StringBuilder(body.Length + 16);
        var pos = 0;
        foreach (var e in edits.OrderBy(e => e.Start))
        {
            sb.Append(body, pos, e.Start - pos).Append(e.Text);
            pos = e.Start + e.Length;
        }
        sb.Append(body, pos, body.Length - pos);

        if (l.CommentStart >= 0)
        {
            if (!restore && o.StripComments)
            {
                report.Count("comments");
                return sb.ToString().TrimEnd();
            }
            sb.Append(restore ? l.Text[l.CommentStart..] : _rules.Redact(l.Text[l.CommentStart..], report));
        }
        return sb.ToString();
    }

    // ── audit ─────────────────────────────────────────────────────────────────

    [GeneratedRegex("[A-Za-z0-9][A-Za-z0-9_.&-]*")]
    private static partial Regex Word();

    public AuditResult Audit(string originalPath, string outputPath)
    {
        var full = Path.GetFullPath(originalPath);
        if (!_perFile.TryGetValue(full, out var inv)) { Scan(originalPath); inv = _perFile[full]; }

        var hunted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var excluded = 0;
        if (_ctx.Profile.Psse.AnonymizeNames)
        {
            foreach (var n in inv.Names)
            {
                if (_preserved.Contains(n)) { excluded++; continue; }
                if (n.Length >= 3 && n.Any(char.IsLetter)) hunted.Add(n);
                foreach (Match w in Word().Matches(n))
                    if (w.Value.Length >= 4 && w.Value.Any(char.IsLetter)) hunted.Add(w.Value);
            }
            // Words that are also part of generated pseudonyms ("BUS", "ZONE") are vocabulary, not identity.
            foreach (var v in _nameMap.Values)
                foreach (Match w in Word().Matches(v)) hunted.Remove(w.Value);
        }

        var leaked = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var terms = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var buses = new HashSet<int>();
        var refs = new List<(int Bus, string Where)>();
        var duplicates = new List<int>();

        void Hunt(string value)
        {
            if (hunted.Count == 0) return;
            var v = value.Trim();
            if (hunted.Contains(v)) leaked.Add(v);
            foreach (Match w in Word().Matches(v)) if (hunted.Contains(w.Value)) leaked.Add(w.Value);
        }

        var walker = new RawWalker();
        using (var reader = FileUtil.OpenText(outputPath, RawEncoding))
        {
            foreach (var l in walker.Walk(reader))
            {
                foreach (var t in _rules.FindTerms(l.Text)) terms.Add(t);
                if (l.Kind == LineKind.Title) { Hunt(l.Text); continue; }
                if (l.Kind is LineKind.Trailer) { Hunt(l.Text); continue; }
                if (l.CommentStart >= 0 && l.Kind != LineKind.Terminator) Hunt(l.Comment);
                if (l.Kind != LineKind.Data) continue;

                foreach (var t in l.Tokens) if (t.Quoted && l.Section != PsseSection.SystemWide) Hunt(t.Inner(l.Text));

                if (l.Section == PsseSection.Bus && l.Tokens.Count > 0 && PsseRaw.TryInt(l.Text, l.Tokens[0], out var b))
                {
                    if (!buses.Add(b)) duplicates.Add(b);
                }
                else
                {
                    foreach (var f in BusFields(l))
                        if (f < l.Tokens.Count && PsseRaw.TryInt(l.Text, l.Tokens[f], out var r) && r != 0)
                            refs.Add((Math.Abs(r), l.SectionKey));
                }
            }
        }

        var integrity = new List<string>();
        var dangling = refs.Where(r => !buses.Contains(r.Bus)).ToList();
        if (dangling.Count > inv.DanglingRefs)
            integrity.AddRange(dangling.Take(10).Select(d => $"{d.Where} references bus {d.Bus}, which is not defined"));
        if (duplicates.Count > 0)
            integrity.Add($"duplicate bus numbers: {string.Join(", ", duplicates.Take(10))}");

        return new AuditResult
        {
            Hunted = hunted.Count + _rules.RedactTerms.Count,
            VocabularyExcluded = excluded,
            LeakedNames = [.. leaked.Take(20)],
            LeakedTerms = [.. terms],
            IntegrityIssues = integrity,
        };
    }

    public void ExportTo(MappingDocument mapping)
    {
        if (_ctx.Restore) return;
        foreach (var (k, v) in _nameMap) mapping.Psse.Names[k] = v;
        foreach (var (k, v) in _busMap) mapping.Psse.Buses[k.ToString()] = v;
    }
}
