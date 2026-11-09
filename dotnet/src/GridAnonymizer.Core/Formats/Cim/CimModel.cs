using System.Text.RegularExpressions;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Formats.Cim;

internal sealed class CimEntity
{
    public string Type { get; set; } = "";
    public string? Name { get; set; }
    public string? Mrid { get; set; }
}

/// <summary>Pass-1 result: everything identifying in a file, without the file.</summary>
internal sealed class CimInventory
{
    public OrderedDictionary<string, CimEntity> Entities { get; } = new(StringComparer.Ordinal);
    public OrderedDictionary<string, int> DescCount { get; } = new(StringComparer.Ordinal);
    public HashSet<string> NameSet { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, int> NameCount { get; } = new(StringComparer.Ordinal);

    /// <summary>Strings used as typed vocabulary values, enum literals or class names.</summary>
    public HashSet<string> VocabValues { get; } = new(StringComparer.Ordinal);

    /// <summary>Every id referenced internally, including ones declared only in sibling files.</summary>
    public List<string> ReferencedIds { get; } = [];
    private readonly HashSet<string> _referenced = new(StringComparer.Ordinal);

    public void AddReference(string id)
    {
        if (_referenced.Add(id)) ReferencedIds.Add(id);
    }

    public void AddName(CimEntity e, string name)
    {
        e.Name = name;
        NameSet.Add(name);
        NameCount[name] = NameCount.GetValueOrDefault(name) + 1;
    }

    /// <summary>
    /// Merge a sibling file's inventory. Unlike v1 (first file wins), a missing
    /// name or mRID is filled from a later file, so an SSH profile listed before
    /// its EQ profile no longer leaves EQ names un-renamed.
    /// </summary>
    public void MergeFrom(CimInventory other)
    {
        foreach (var (id, e) in other.Entities)
        {
            if (!Entities.TryGetValue(id, out var mine))
            {
                Entities.Add(id, new CimEntity { Type = e.Type, Name = e.Name, Mrid = e.Mrid });
                continue;
            }
            mine.Name ??= e.Name;
            mine.Mrid ??= e.Mrid;
        }
        foreach (var (d, c) in other.DescCount) DescCount[d] = DescCount.GetValueOrDefault(d) + c;
        foreach (var n in other.NameSet) NameSet.Add(n);
        foreach (var (n, c) in other.NameCount) NameCount[n] = NameCount.GetValueOrDefault(n) + c;
        foreach (var v in other.VocabValues) VocabValues.Add(v);
        foreach (var r in other.ReferencedIds) AddReference(r);
    }
}

internal sealed class CimMaps
{
    public Dictionary<string, string> Ids { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, string> Names { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, string> Mrids { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, string> Descs { get; } = new(StringComparer.Ordinal);
    public HashSet<string> Preserved { get; } = new(StringComparer.Ordinal);
    public int ExternalCount { get; set; }
}

/// <summary>Regular expressions compiled once per run from the profile.</summary>
internal sealed class CimPatterns
{
    private const string W = "[A-Za-z0-9_]";

    public Regex Scan { get; }
    public Regex Rewrite { get; }
    public static readonly Regex Vocab = new($"<{W}+:[A-Za-z0-9_.]*(?:[Tt]ype|Kind)>([^<]*)<", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    public static readonly Regex EnumRef = new($"rdf:resource=\"http[^\"]*#({W}+)\\.({W}+)\"", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    public static readonly Regex Class = new($"<({W}+):({W}+)[\\s>]", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    public static readonly Regex InternalRef = new("rdf:resource=\"#([^\"]*)\"|rdf:resource=\"(urn:uuid:[^\"]*)\"", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    public static readonly Regex Comment = new("<!--[\\s\\S]*?-->", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    public static readonly Regex Word = new("[A-Za-z][A-Za-z0-9]{2,}", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    /// <summary>Constructs the streaming rules cannot see into; such files are refused rather than half-anonymized.</summary>
    public static readonly Regex Unsupported = new("rdf:(?:ID|about|resource)\\s*=\\s*'|<!\\[CDATA\\[", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    public static readonly Regex TextNode = new(">([^<]+)<", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public CimPatterns(CimOptions o)
    {
        var names = Alt(o.NameProperties);
        var descs = Alt(o.DescriptionProperties);
        var headers = AltQualified(o.HeaderProperties.Keys);
        var overwrite = Alt(o.OverwriteProperties.Keys);

        Scan = new Regex(
            $"<({W}+):({W}+)\\s+(?:[^>]*?\\s)?rdf:(ID|about)=\"([^\"]*)\"" +
            $"|<{W}+:{names}(?:\\s[^>/]*)?>([^<]*)<" +
            $"|<{W}+:IdentifiedObject\\.mRID(?:\\s[^>/]*)?>([^<]*)<" +
            $"|<{W}+:{descs}(?:\\s[^>/]*)?>([^<]*)<",
            RegexOptions.CultureInvariant | RegexOptions.Compiled);

        Rewrite = new Regex(
            $"(?<idPre><{W}+:{W}+\\s+(?:[^>]*?\\s)?rdf:(?:ID|about)=\")(?<id>[^\"]*)\"" +
            "|(?<refPre>rdf:resource=\"#)(?<ref>[^\"]*)\"" +
            $"|(?<namePre><{W}+:{names}(?:\\s[^>/]*)?>)(?<name>[^<]*)<" +
            $"|(?<mridPre><{W}+:IdentifiedObject\\.mRID(?:\\s[^>/]*)?>)(?<mrid>[^<]*)<" +
            $"|(?<descPre><{W}+:{descs}(?:\\s[^>/]*)?>)(?<desc>[^<]*)<" +
            "|(?<urnPre>rdf:resource=\"urn:uuid:)(?<urn>[^\"]*)\"" +
            $"|(?<hdrPre><(?<hdrTag>{headers})>)(?<hdr>[^<]*)<" +
            $"|(?<owPre><{W}+:(?<owTag>{overwrite})>)(?<ow>[^<]*)<",
            RegexOptions.CultureInvariant | RegexOptions.ExplicitCapture | RegexOptions.Compiled);
    }

    private static string Alt(IEnumerable<string> localNames)
    {
        var list = localNames.Where(s => s.Length > 0).Select(Regex.Escape).ToList();
        return list.Count == 0 ? "(?!)" : "(?:" + string.Join("|", list) + ")";
    }

    private static string AltQualified(IEnumerable<string> qnames)
    {
        var list = qnames.Where(s => s.Length > 0).Select(Regex.Escape).ToList();
        return list.Count == 0 ? "(?!)" : string.Join("|", list);
    }
}
