using GridAnonymizer.Mapping;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Engine;

/// <summary>
/// A file format the engine understands. To add one (say, PowerFactory DGS or
/// PSS/E DYR), implement this and its <see cref="IFormatJob"/>, then register it
/// in <see cref="FormatRegistry"/>. See docs/extending.md.
/// </summary>
public interface IFormatHandler
{
    /// <summary>Short id used on the command line (<c>--format cim</c>).</summary>
    string Id { get; }

    string Description { get; }

    /// <summary>Extensions (lower case, with dot) that suggest this format.</summary>
    IReadOnlyList<string> Extensions { get; }

    /// <summary>True when the first few KB of a file look like this format.</summary>
    bool Sniff(string head);

    IFormatJob CreateJob(JobContext context);

    /// <summary>
    /// When this format runs. 0: models that define names (CIM, PSS/E RAW).
    /// 1: files that follow a model in the same run (PSS/E .con/.mon/.sub/.aux).
    /// 2: free text that only reuses names already mapped.
    /// Formats with a phase above 0 see the run's mapping so far.
    /// </summary>
    int Phase => 0;
}

/// <summary>
/// One run over a group of files of the same format. The engine calls
/// <see cref="Scan"/> for every file, then <see cref="BuildMaps"/> once, then
/// <see cref="Rewrite"/> and <see cref="Audit"/> per file - so a multi-file set
/// (a CGMES EQ/SSH/TP/SV set, or several PSS/E cases of one system) shares one
/// consistent mapping.
/// </summary>
public interface IFormatJob
{
    void Scan(string path);
    void BuildMaps();
    FileReport Rewrite(string inputPath, string outputPath);
    AuditResult Audit(string originalPath, string outputPath);
    void ExportTo(MappingDocument mapping);
}

public sealed class JobContext
{
    public required AnonymizationProfile Profile { get; init; }
    public required string Salt { get; init; }

    /// <summary>Mapping from an earlier run to stay consistent with (or to invert, when restoring).</summary>
    public MappingDocument? Mapping { get; init; }

    /// <summary>True for <c>gridanon restore</c>: apply the inverse of <see cref="Mapping"/>.</summary>
    public bool Restore { get; init; }
}

public sealed class RunReport
{
    public string Tool { get; set; } = "";
    public string Mode { get; set; } = "anonymize";
    public DateTimeOffset Started { get; set; } = DateTimeOffset.UtcNow;
    public string? Profile { get; set; }
    public List<FileReport> Files { get; set; } = [];
    public bool Clean => Files.TrueForAll(f => f.Audit?.Clean ?? true);
}

public sealed class FileReport
{
    public string Input { get; set; } = "";
    public string? Output { get; set; }
    public string Format { get; set; } = "";
    public long BytesIn { get; set; }
    public long BytesOut { get; set; }
    public Dictionary<string, long> Stats { get; set; } = [];
    public AuditResult? Audit { get; set; }
    public List<string> Warnings { get; set; } = [];

    public void Count(string key, long by = 1) => Stats[key] = Stats.GetValueOrDefault(key) + by;
}

public sealed class AuditResult
{
    /// <summary>Identifying values searched for in the output.</summary>
    public int Hunted { get; set; }

    /// <summary>Labels deliberately kept as shared vocabulary and therefore not hunted.</summary>
    public int VocabularyExcluded { get; set; }

    public List<string> LeakedNames { get; set; } = [];
    public List<string> LeakedIds { get; set; } = [];
    public List<string> LeakedTerms { get; set; } = [];

    /// <summary>Structural problems in the output, e.g. a reference to a bus that does not exist.</summary>
    public List<string> IntegrityIssues { get; set; } = [];

    public bool Clean => LeakedNames.Count == 0 && LeakedIds.Count == 0 && LeakedTerms.Count == 0 && IntegrityIssues.Count == 0;
}
