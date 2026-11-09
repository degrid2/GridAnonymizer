using System.Text;
using System.Text.RegularExpressions;
using GridAnonymizer.Engine;
using GridAnonymizer.Mapping;

namespace GridAnonymizer.Formats.Psse;

/// <summary>
/// PSS/E companion files: contingency (.con), monitored element (.mon),
/// subsystem (.sub) and auxiliary (.aux) descriptions. They run after the RAW
/// case of the same run and reuse its mapping, so every bus number and name in
/// them follows the case.
/// </summary>
/// <remarks>
/// Rules: an integer after the keyword <c>BUS</c> is a bus number;
/// <c>BUSES a [TO] b</c> is a range, expanded into one <c>BUS</c> line per
/// renumbered bus; a quoted string after <c>BUS</c> is an extended bus name;
/// any other quoted string is a label (contingency, subsystem, interface...) and
/// gets a pseudonym such as <c>CTG_0001</c>; <c>COM</c> lines are comments.
/// Everything else (keywords, circuit and machine ids, MW, kV, areas) is kept.
/// </remarks>
public sealed class PsseAuxHandler : IFormatHandler
{
    public string Id => "psse-aux";
    public string Description => "PSS/E contingency, monitored element, subsystem and auxiliary files (.con .mon .sub .aux), following the case in the same run";
    public IReadOnlyList<string> Extensions { get; } = [".con", ".mon", ".sub", ".aux"];
    public bool Sniff(string head) => false;
    public int Phase => 1;
    public IFormatJob CreateJob(JobContext context) => new PsseAuxJob(context);
}

internal sealed partial class PsseAuxJob(JobContext ctx) : IFormatJob
{
    private static readonly Encoding RawEncoding = Encoding.Latin1;
    private readonly GlobalRules _rules = new(ctx.Profile);
    private readonly Regex[] _keep = [.. ctx.Profile.Psse.KeepStringPatterns.Select(p => new Regex(p, RegexOptions.CultureInvariant))];

    private readonly List<(string Label, string Prefix)> _labels = [];
    private readonly HashSet<string> _labelSeen = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (HashSet<string> Names, int Dangling)> _perFile = new(StringComparer.Ordinal);

    private Dictionary<string, string> _names = new(StringComparer.Ordinal);
    private Dictionary<int, int> _buses = [];
    private List<int> _originalBuses = [];
    private readonly Dictionary<string, string> _newLabels = new(StringComparer.Ordinal);

    private static readonly Dictionary<string, string> LabelPrefixes = new(StringComparer.Ordinal)
    {
        ["CONTINGENCY"] = "CTG",
        ["SUBSYSTEM"] = "SUBSYS",
        ["SUBSYS"] = "SUBSYS",
        ["INTERFACE"] = "INTF",
        ["JOIN"] = "JOIN",
        ["TIE"] = "TIE",
        ["GROUP"] = "GROUP",
    };

    private sealed record AuxLine(string Text, List<RawToken> Tokens, int CommentStart, bool IsCom);

    private static IEnumerable<AuxLine> Lines(string path)
    {
        using var reader = FileUtil.OpenText(path, RawEncoding);
        string? text;
        while ((text = reader.ReadLine()) is not null)
        {
            var tokens = PsseRaw.Tokenize(text, out var cs);
            var isCom = tokens.Count > 0 && !tokens[0].Quoted && tokens[0].Text(text).Equals("COM", StringComparison.OrdinalIgnoreCase);
            yield return new AuxLine(text, tokens, cs, isCom);
        }
    }

    private static string Upper(AuxLine l, int i) => l.Tokens[i].Quoted ? "" : l.Tokens[i].Text(l.Text).ToUpperInvariant();

    private bool IsKept(string inner) => inner.Trim().Length == 0 || Array.Exists(_keep, r => r.IsMatch(inner));

    /// <summary>Label prefix from the nearest keyword before the quoted token.</summary>
    private static string PrefixFor(AuxLine l, int i)
    {
        for (var j = i - 1; j >= 0; j--)
            if (!l.Tokens[j].Quoted && LabelPrefixes.TryGetValue(Upper(l, j), out var p)) return p;
        return "LABEL";
    }

    private static bool IsBusRange(AuxLine l, int i, out int lo, out int hi, out int end)
    {
        lo = hi = end = 0;
        if (Upper(l, i) != "BUSES" || i + 2 >= l.Tokens.Count) return false;
        if (!PsseRaw.TryInt(l.Text, l.Tokens[i + 1], out lo)) return false;
        var j = i + 2;
        if (j < l.Tokens.Count && Upper(l, j) == "TO") j++;
        if (j >= l.Tokens.Count || !PsseRaw.TryInt(l.Text, l.Tokens[j], out hi)) return false;
        end = j;
        return true;
    }

    // ── pass 1 ────────────────────────────────────────────────────────────────

    public void Scan(string path)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var l in Lines(path))
        {
            if (l.IsCom) continue;
            for (var i = 0; i < l.Tokens.Count; i++)
            {
                var t = l.Tokens[i];
                if (!t.Quoted) continue;
                var inner = t.Inner(l.Text);
                var key = inner.Trim();
                names.Add(key);
                var afterBus = i > 0 && Upper(l, i - 1) == "BUS";
                if (afterBus || IsKept(inner)) continue;
                if (_labelSeen.Add(key)) _labels.Add((key, PrefixFor(l, i)));
            }
        }
        _perFile[Path.GetFullPath(path)] = (names, 0);
    }

    public void BuildMaps()
    {
        var m = ctx.Mapping ?? new MappingDocument();
        if (ctx.Restore)
        {
            foreach (var (k, v) in m.Psse.Names) if (k != v) _names.TryAdd(v, k);
            foreach (var (k, v) in m.Psse.Buses) if (int.TryParse(k, out var orig)) _buses.TryAdd(v, orig);
            return;
        }

        foreach (var (k, v) in m.Psse.Names) _names[k] = v;
        foreach (var (k, v) in m.Psse.Buses)
            if (int.TryParse(k, out var orig)) { _buses[orig] = v; _originalBuses.Add(orig); }

        if (ctx.Profile.Psse.AnonymizeNames)
        {
            var counter = new NameCounter(_names.Values);
            foreach (var (label, prefix) in _labels)
            {
                if (_names.ContainsKey(label)) continue;
                if (_rules.IsPreserved(label)) { _names[label] = label; continue; }
                var pseudonym = counter.NextName(prefix);
                _names[label] = pseudonym;
                _newLabels[label] = pseudonym;
            }
        }
    }

    // ── pass 2 ────────────────────────────────────────────────────────────────

    public FileReport Rewrite(string inputPath, string outputPath)
    {
        var report = new FileReport { Input = inputPath, Output = outputPath, Format = "psse-aux", BytesIn = FileUtil.Size(inputPath) };
        var restore = ctx.Restore;
        var o = ctx.Profile.Psse;
        var renumber = _buses.Count > 0;
        var missing = new List<int>();
        var newLine = FileUtil.DetectNewLine(inputPath);

        FileUtil.WriteAtomically(outputPath, RawEncoding, writer =>
        {
            writer.NewLine = newLine;
            foreach (var l in Lines(inputPath))
            {
                if (l.IsCom)
                {
                    if (!restore && o.StripComments) { report.Count("comments"); continue; }
                    writer.WriteLine(restore ? l.Text : _rules.Redact(l.Text, report));
                    continue;
                }

                // A bus range cannot survive renumbering: expand it into explicit buses.
                if (renumber && !restore)
                {
                    var range = Enumerable.Range(0, l.Tokens.Count).FirstOrDefault(i => IsBusRange(l, i, out _, out _, out _), -1);
                    if (range >= 0 && IsBusRange(l, range, out var lo, out var hi, out _))
                    {
                        var indent = l.Text[..l.Tokens[range].Start];
                        var inRange = _originalBuses.Where(b => b >= lo && b <= hi).Select(b => _buses[b]).Order().ToList();
                        foreach (var nb in inRange) writer.WriteLine($"{indent}BUS {nb}");
                        report.Count("rangesExpanded");
                        report.Count("busNumbers", inRange.Count);
                        continue;
                    }
                }

                var edits = new List<(int Start, int Length, string Text)>();
                for (var i = 0; i < l.Tokens.Count; i++)
                {
                    var t = l.Tokens[i];
                    var afterBus = i > 0 && Upper(l, i - 1) == "BUS";
                    if (t.Quoted)
                    {
                        var inner = t.Inner(l.Text);
                        var replacement = MapName(inner, afterBus);
                        if (replacement is not null && replacement != inner)
                        {
                            edits.Add((t.Start + 1, t.Length - 2, replacement));
                            report.Count(afterBus ? "names" : "labels");
                        }
                        else if (!restore && _rules.HasRedactions)
                        {
                            var red = _rules.Redact(inner, report);
                            if (red != inner) edits.Add((t.Start + 1, t.Length - 2, red));
                        }
                    }
                    else if (afterBus && renumber && PsseRaw.TryInt(l.Text, t, out var bus) && bus != 0)
                    {
                        if (_buses.TryGetValue(Math.Abs(bus), out var nb))
                        {
                            edits.Add((t.Start, t.Length, ((bus < 0 ? "-" : "") + nb).PadLeft(t.Length)));
                            report.Count("busNumbers");
                        }
                        else
                        {
                            report.Count("unmappedBusRefs");
                            if (missing.Count < 5 && !missing.Contains(bus)) missing.Add(bus);
                        }
                    }
                }

                var body = l.CommentStart >= 0 ? l.Text[..l.CommentStart] : l.Text;
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
                    if (!restore && o.StripComments) { report.Count("comments"); writer.WriteLine(sb.ToString().TrimEnd()); continue; }
                    sb.Append(restore ? l.Text[l.CommentStart..] : _rules.Redact(l.Text[l.CommentStart..], report));
                }
                writer.WriteLine(sb.ToString());
            }
        });

        if (missing.Count > 0)
            report.Warnings.Add($"Buses not in the case were left unchanged, e.g. {string.Join(", ", missing)}. Anonymize the .raw file in the same run.");
        if (!restore && o.RenumberBuses && !renumber)
            report.Warnings.Add("Bus renumbering is on, but no PSS/E case was renumbered in this run, so bus numbers here were kept. Add the .raw file to the same run.");
        report.BytesOut = FileUtil.Size(outputPath);
        return report;
    }

    [GeneratedRegex(@"^(.*?)(\s+[\d.]+)$")]
    private static partial Regex ExtendedBusName();

    /// <summary>Pseudonym for a quoted token, padded to the original width; null when it is kept.</summary>
    private string? MapName(string inner, bool afterBus)
    {
        var key = inner.Trim();
        if (!ctx.Restore && !afterBus && IsKept(inner)) return null;
        if (_names.TryGetValue(key, out var mapped) && mapped != key)
            return mapped.Length < inner.Length ? mapped.PadRight(inner.Length) : mapped;
        if (afterBus && ExtendedBusName().Match(key) is { Success: true } m && _names.TryGetValue(m.Groups[1].Value.Trim(), out var busName))
        {
            // Extended bus name: 'NAME     345' keeps its kV part.
            var rebuilt = busName.PadRight(Math.Max(busName.Length, m.Groups[1].Value.Length)) + m.Groups[2].Value;
            return rebuilt.Length < inner.Length ? rebuilt.PadRight(inner.Length) : rebuilt;
        }
        return null;
    }

    // ── audit ─────────────────────────────────────────────────────────────────

    [GeneratedRegex("[A-Za-z0-9][A-Za-z0-9_.&-]*")]
    private static partial Regex Word();

    public AuditResult Audit(string originalPath, string outputPath)
    {
        var hunted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (ctx.Profile.Psse.AnonymizeNames)
        {
            void Add(string n)
            {
                if (n.Length >= 3 && n.Any(char.IsLetter)) hunted.Add(n);
                foreach (Match w in Word().Matches(n)) if (w.Value.Length >= 4 && w.Value.Any(char.IsLetter)) hunted.Add(w.Value);
            }
            foreach (var (k, v) in _names) if (k != v) Add(k);
            foreach (var v in _names.Values) foreach (Match w in Word().Matches(v)) hunted.Remove(w.Value);
        }

        var leaked = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var terms = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var integrity = new List<string>();
        var newBuses = new HashSet<int>(_buses.Values);

        void Hunt(string value)
        {
            if (hunted.Count == 0) return;
            var v = value.Trim();
            if (hunted.Contains(v)) leaked.Add(v);
            foreach (Match w in Word().Matches(v)) if (hunted.Contains(w.Value)) leaked.Add(w.Value);
        }

        int Dangling(string path, HashSet<int> known)
        {
            var n = 0;
            foreach (var l in Lines(path))
            {
                if (l.IsCom) continue;
                for (var i = 1; i < l.Tokens.Count; i++)
                    if (Upper(l, i - 1) == "BUS" && PsseRaw.TryInt(l.Text, l.Tokens[i], out var b) && b != 0 && !known.Contains(Math.Abs(b))) n++;
            }
            return n;
        }

        foreach (var l in Lines(outputPath))
        {
            foreach (var t in _rules.FindTerms(l.Text)) terms.Add(t);
            if (l.IsCom) { Hunt(l.Text[3..]); continue; }
            foreach (var t in l.Tokens) if (t.Quoted) Hunt(t.Inner(l.Text));
            if (l.CommentStart >= 0) Hunt(l.Text[(l.CommentStart + 1)..]);
        }

        if (_buses.Count > 0)
        {
            var before = Dangling(originalPath, [.. _buses.Keys]);
            var after = Dangling(outputPath, newBuses);
            if (after > before) integrity.Add($"{after - before} bus reference(s) point to buses that are not in the case");
        }

        return new AuditResult
        {
            Hunted = hunted.Count + _rules.RedactTerms.Count,
            LeakedNames = [.. leaked.Take(20)],
            LeakedTerms = [.. terms],
            IntegrityIssues = integrity,
        };
    }

    public void ExportTo(MappingDocument mapping)
    {
        if (ctx.Restore) return;
        foreach (var (k, v) in _newLabels) mapping.Psse.Names[k] = v;
    }
}
