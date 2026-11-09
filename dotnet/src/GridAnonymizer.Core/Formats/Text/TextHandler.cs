using System.Text.RegularExpressions;
using GridAnonymizer.Engine;
using GridAnonymizer.Mapping;

namespace GridAnonymizer.Formats.Text;

/// <summary>
/// Any text file - CSV results, contingency lists, study reports, scripts - is
/// rewritten with the names and ids mapped by the structured formats in the same
/// run (or loaded with --use-mapping). It never invents new pseudonyms, so it
/// only ever replaces what a model file already defined.
/// </summary>
public sealed class TextHandler : IFormatHandler
{
    public string Id => "text";
    public string Description => "Any text file: applies the run's name/id mapping (whole-word, longest match first)";
    public IReadOnlyList<string> Extensions { get; } = [".csv", ".txt", ".con", ".mon", ".sub", ".log", ".json", ".py", ".idv"];
    public bool Sniff(string head) => false;
    public IFormatJob CreateJob(JobContext context) => new TextJob(context);
}

internal sealed class TextJob(JobContext ctx) : IFormatJob
{
    private Dictionary<string, string> _pairs = new(StringComparer.Ordinal);
    private Regex? _regex;
    private readonly GlobalRules _rules = new(ctx.Profile);

    public void Scan(string path) { }

    public void BuildMaps()
    {
        var mapping = ctx.Mapping ?? new MappingDocument();
        var min = ctx.Profile.Text.MinNameLength;
        foreach (var (k, v) in mapping.AllTextPairs())
        {
            var (from, to) = ctx.Restore ? (v, k) : (k, v);
            from = from.Trim();
            if (from.Length < min || from == to.Trim() || from.All(char.IsDigit)) continue;
            _pairs.TryAdd(from, to.Trim());
        }
        if (_pairs.Count == 0) return;
        var alt = string.Join("|", _pairs.Keys.OrderByDescending(k => k.Length).ThenBy(k => k, StringComparer.Ordinal).Select(Regex.Escape));
        _regex = new Regex($"(?<![A-Za-z0-9_])(?:{alt})(?![A-Za-z0-9_])", RegexOptions.CultureInvariant);
    }

    public FileReport Rewrite(string inputPath, string outputPath)
    {
        var report = new FileReport { Input = inputPath, Output = outputPath, Format = "text", BytesIn = FileUtil.Size(inputPath) };
        if (_regex is null) report.Warnings.Add("No mapping available; file copied unchanged apart from redact terms.");
        var newLine = FileUtil.DetectNewLine(inputPath);
        FileUtil.WriteAtomically(outputPath, FileUtil.Utf8NoBom, writer =>
        {
            writer.NewLine = newLine;
            using var reader = FileUtil.OpenText(inputPath, FileUtil.Utf8NoBom);
            string? line;
            while ((line = reader.ReadLine()) is not null)
            {
                if (_regex is not null)
                    line = _regex.Replace(line, m => { report.Count("replacements"); return _pairs[m.Value]; });
                if (!ctx.Restore) line = _rules.Redact(line, report);
                writer.WriteLine(line);
            }
        });
        report.BytesOut = FileUtil.Size(outputPath);
        return report;
    }

    public AuditResult Audit(string originalPath, string outputPath)
    {
        // A text file has no inventory of its own: hunt for every mapped original.
        var result = new AuditResult { Hunted = _pairs.Count + _rules.RedactTerms.Count };
        var leaked = new SortedSet<string>(StringComparer.Ordinal);
        using var reader = FileUtil.OpenText(outputPath, FileUtil.Utf8NoBom);
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            if (_regex is not null)
                foreach (Match m in _regex.Matches(line)) if (leaked.Count < 20) leaked.Add(m.Value);
            foreach (var t in _rules.FindTerms(line)) if (!result.LeakedTerms.Contains(t)) result.LeakedTerms.Add(t);
        }
        result.LeakedNames = [.. leaked];
        return result;
    }

    public void ExportTo(MappingDocument mapping) { }
}
