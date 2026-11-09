using System.Text.RegularExpressions;
using GridAnonymizer.Engine;
using GridAnonymizer.Hashing;
using GridAnonymizer.IO;
using GridAnonymizer.Mapping;

namespace GridAnonymizer.Formats.Cim;

/// <summary>IEC 61970 CIM / ENTSO-E CGMES models serialized as RDF/XML.</summary>
public sealed class CimHandler : IFormatHandler
{
    public string Id => "cim";
    public string Description => "CIM / CGMES RDF-XML (IEC 61970-552), single files or multi-profile sets";
    public IReadOnlyList<string> Extensions { get; } = [".xml", ".rdf"];

    public bool Sniff(string head) =>
        head.Contains("rdf:RDF", StringComparison.Ordinal) ||
        head.Contains("22-rdf-syntax-ns", StringComparison.Ordinal);

    public IFormatJob CreateJob(JobContext context) => new CimJob(context);
}

internal sealed class CimJob(JobContext ctx) : IFormatJob
{
    private readonly CimPatterns _patterns = new(ctx.Profile.Cim);
    private readonly GlobalRules _rules = new(ctx.Profile);
    private readonly CimInventory _merged = new();
    private readonly Dictionary<string, CimInventory> _perFile = new(StringComparer.Ordinal);
    private CimMaps? _maps;

    public void Scan(string path)
    {
        var inv = ScanFile(path);
        _perFile[Path.GetFullPath(path)] = inv;
        _merged.MergeFrom(inv);
    }

    private CimInventory ScanFile(string path)
    {
        var inv = new CimInventory();
        CimEntity? current = null;
        using var reader = FileUtil.OpenText(path, FileUtil.Utf8NoBom);
        foreach (var raw in XmlChunker.Read(reader))
        {
            var body = CimPatterns.Comment.Replace(raw, "");
            if (CimPatterns.Unsupported.Match(body) is { Success: true } bad)
                throw new NotSupportedException(
                    $"{Path.GetFileName(path)}: contains {(bad.Value.StartsWith('<') ? "a CDATA section" : "a single-quoted rdf attribute")}, " +
                    "which this version cannot anonymize safely. Re-export with double-quoted attributes and no CDATA, or open an issue.");

            foreach (Match m in CimPatterns.Vocab.Matches(body))
                if (m.Groups[1].Value.Length > 0 && !m.Groups[1].Value.StartsWith("http", StringComparison.Ordinal))
                    inv.VocabValues.Add(m.Groups[1].Value);
            foreach (Match m in CimPatterns.EnumRef.Matches(body))
            {
                inv.VocabValues.Add(m.Groups[2].Value);
                inv.VocabValues.Add(m.Groups[1].Value);
            }
            foreach (Match m in CimPatterns.Class.Matches(body)) inv.VocabValues.Add(m.Groups[2].Value);
            foreach (Match m in CimPatterns.InternalRef.Matches(body))
                inv.AddReference(m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value);

            foreach (Match m in _patterns.Scan.Matches(body))
            {
                var g = m.Groups;
                if (g[4].Success)
                {
                    var id = g[4].Value.StartsWith('#') ? g[4].Value[1..] : g[4].Value;
                    if (!inv.Entities.TryGetValue(id, out current))
                    {
                        current = new CimEntity { Type = $"{g[1].Value}:{g[2].Value}" };
                        inv.Entities.Add(id, current);
                    }
                }
                else if (g[5].Success && current is not null)
                {
                    if (current.Name is null) inv.AddName(current, g[5].Value);
                }
                else if (g[6].Success && current is not null)
                {
                    current.Mrid = g[6].Value;
                }
                else if (g[7].Success)
                {
                    inv.DescCount[g[7].Value] = inv.DescCount.GetValueOrDefault(g[7].Value) + 1;
                }
            }
        }
        return inv;
    }

    public void BuildMaps()
    {
        if (ctx.Restore)
        {
            _maps = Invert(ctx.Mapping?.Cim ?? throw new InvalidOperationException("restore needs a mapping"));
            return;
        }
        _maps = CimMapBuilder.Build(_merged, ctx.Profile.Cim, _rules, ctx.Salt, ctx.Mapping?.Cim);
    }

    private static CimMaps Invert(CimMapping m)
    {
        var maps = new CimMaps();
        static void Inv(Dictionary<string, string> src, Dictionary<string, string> dst)
        {
            foreach (var (k, v) in src)
                if (k != v) dst.TryAdd(v, k);
        }
        Inv(m.Ids, maps.Ids);
        Inv(m.Names, maps.Names);
        Inv(m.Mrids, maps.Mrids);
        Inv(m.Descriptions, maps.Descs);
        return maps;
    }

    public FileReport Rewrite(string inputPath, string outputPath)
    {
        var maps = _maps ?? throw new InvalidOperationException("BuildMaps first");
        var o = ctx.Profile.Cim;
        var report = new FileReport { Input = inputPath, Output = outputPath, Format = "cim", BytesIn = FileUtil.Size(inputPath) };
        var stripComments = o.StripComments && !ctx.Restore;
        var replaceHeaders = o.ReplaceHeaders && !ctx.Restore;
        var overwrite = !ctx.Restore;

        string Escape(string mapped, string original) =>
            mapped == original ? mapped : mapped.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

        string Evaluate(Match m)
        {
            var g = m.Groups;
            if (g["idPre"].Success)
            {
                var raw = g["id"].Value;
                var hash = raw.StartsWith('#');
                if (maps.Ids.TryGetValue(hash ? raw[1..] : raw, out var mapped))
                {
                    report.Count("ids");
                    return g["idPre"].Value + (hash ? "#" : "") + mapped + "\"";
                }
                return m.Value;
            }
            if (g["refPre"].Success)
            {
                if (maps.Ids.TryGetValue(g["ref"].Value, out var mapped)) { report.Count("refs"); return g["refPre"].Value + mapped + "\""; }
                report.Count("unmappedRefs");
                return m.Value;
            }
            if (g["namePre"].Success)
            {
                var v = g["name"].Value;
                if (maps.Names.TryGetValue(v, out var mapped)) { report.Count("names"); return g["namePre"].Value + Escape(mapped, v) + "<"; }
                return m.Value;
            }
            if (g["mridPre"].Success)
            {
                if (maps.Mrids.TryGetValue(g["mrid"].Value, out var mapped)) { report.Count("mrids"); return g["mridPre"].Value + mapped + "<"; }
                return m.Value;
            }
            if (g["descPre"].Success)
            {
                var v = g["desc"].Value;
                if (maps.Descs.TryGetValue(v, out var mapped)) { report.Count("descriptions"); return g["descPre"].Value + Escape(mapped, v) + "<"; }
                return m.Value;
            }
            if (g["urnPre"].Success)
            {
                if (maps.Ids.TryGetValue("urn:uuid:" + g["urn"].Value, out var mapped))
                {
                    report.Count("refs");
                    return g["urnPre"].Value + (mapped.StartsWith("urn:uuid:", StringComparison.Ordinal) ? mapped[9..] : mapped) + "\"";
                }
                report.Count("unmappedRefs");
                return m.Value;
            }
            if (g["hdrPre"].Success)
            {
                if (!replaceHeaders || !o.HeaderProperties.TryGetValue(g["hdrTag"].Value, out var template)) return m.Value;
                report.Count("headers");
                var value = template.Replace("{hash8}", Pseudonym.HexDigest(ctx.Salt, "mas " + g["hdr"].Value, 8), StringComparison.Ordinal);
                return g["hdrPre"].Value + value + "<";
            }
            if (g["owPre"].Success)
            {
                if (!overwrite || !o.OverwriteProperties.TryGetValue(g["owTag"].Value, out var value)) return m.Value;
                report.Count("overwritten");
                return g["owPre"].Value + value + "<";
            }
            return m.Value;
        }

        FileUtil.WriteAtomically(outputPath, FileUtil.Utf8NoBom, writer =>
        {
            using var reader = FileUtil.OpenText(inputPath, FileUtil.Utf8NoBom);
            foreach (var raw in XmlChunker.Read(reader))
            {
                var text = raw;
                if (stripComments)
                    text = CimPatterns.Comment.Replace(text, _ => { report.Count("comments"); return ""; });
                text = _patterns.Rewrite.Replace(text, Evaluate);
                if (_rules.HasRedactions && !ctx.Restore)
                    text = CimPatterns.TextNode.Replace(text, m => ">" + _rules.Redact(m.Groups[1].Value, report) + "<");
                writer.Write(text);
            }
        });

        report.BytesOut = FileUtil.Size(outputPath);
        if (maps.ExternalCount > 0) report.Stats["externalIds"] = maps.ExternalCount;
        return report;
    }

    private static readonly Regex AuditValue = new("\"([^\"]*)\"|>([^<>]+)<", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex AuditToken = new("[A-Za-z0-9_][A-Za-z0-9_.-]*", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex HasLetter = new("[A-Za-z]", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex HasSeparator = new("[ _/#:-]", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>
    /// Re-read the output and hunt for anything identifying from the original:
    /// names (whole values and embedded tokens), ids, and the profile's redact terms.
    /// Shared vocabulary is excluded on the same terms the anonymizer kept it, and
    /// the exclusion is counted so it is visible rather than silent.
    /// </summary>
    public AuditResult Audit(string originalPath, string outputPath)
    {
        var full = Path.GetFullPath(originalPath);
        if (!_perFile.TryGetValue(full, out var inv)) _perFile[full] = inv = ScanFile(originalPath);

        var origNames = new HashSet<string>(StringComparer.Ordinal);
        var origIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (id, e) in inv.Entities)
        {
            if (_maps is not null && !_maps.Ids.ContainsKey(id)) { if (e.Name is not null) origNames.Add(e.Name); continue; }
            origIds.Add(id);
            if (e.Name is not null) origNames.Add(e.Name);
        }

        var preserved = _maps?.Preserved ?? [];
        var vocabulary = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (n, c) in inv.NameCount) if (c >= ctx.Profile.Cim.VocabularyMinCount) vocabulary.Add(n);
        foreach (var n in origNames) if (inv.VocabValues.Contains(n) || preserved.Contains(n)) vocabulary.Add(n);

        var hunted = new HashSet<string>(StringComparer.Ordinal);
        foreach (var n in origNames)
            if (n.Length >= 4 && HasLetter.IsMatch(n) && !vocabulary.Contains(n)) hunted.Add(n);
        if (!ctx.Profile.Cim.AnonymizeNames) hunted.Clear();
        if (!ctx.Profile.Cim.AnonymizeIds) origIds.Clear();

        var leakedNames = new SortedSet<string>(StringComparer.Ordinal);
        var leakedIds = new SortedSet<string>(StringComparer.Ordinal);
        var leakedTerms = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);

        using var reader = FileUtil.OpenText(outputPath, FileUtil.Utf8NoBom);
        foreach (var chunk in XmlChunker.Read(reader))
        {
            foreach (Match m in AuditValue.Matches(chunk))
            {
                var value = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value;
                if (value.Length == 0) continue;
                if (hunted.Contains(value)) leakedNames.Add(value);
                if (origIds.Contains(value)) leakedIds.Add(value);
                if (value.Length > 4 && HasSeparator.IsMatch(value))
                {
                    foreach (Match t in AuditToken.Matches(value))
                    {
                        if (hunted.Contains(t.Value)) leakedNames.Add(t.Value);
                        if (origIds.Contains(t.Value)) leakedIds.Add(t.Value);
                    }
                }
            }
            if (_rules.HasRedactions)
                foreach (Match m in CimPatterns.TextNode.Matches(chunk))
                    foreach (var t in _rules.FindTerms(m.Groups[1].Value)) leakedTerms.Add(t);
        }

        return new AuditResult
        {
            Hunted = hunted.Count + _rules.RedactTerms.Count,
            VocabularyExcluded = vocabulary.Count,
            LeakedNames = [.. leakedNames.Take(20)],
            LeakedIds = [.. leakedIds.Take(20)],
            LeakedTerms = [.. leakedTerms],
        };
    }

    public void ExportTo(MappingDocument mapping)
    {
        if (_maps is null || ctx.Restore) return;
        foreach (var p in _maps.Ids) mapping.Cim.Ids[p.Key] = p.Value;
        foreach (var p in _maps.Names) mapping.Cim.Names[p.Key] = p.Value;
        foreach (var p in _maps.Mrids) mapping.Cim.Mrids[p.Key] = p.Value;
        foreach (var p in _maps.Descs) mapping.Cim.Descriptions[p.Key] = p.Value;
        mapping.Cim.Preserved = [.. mapping.Cim.Preserved.Union(_maps.Preserved)];
    }
}
