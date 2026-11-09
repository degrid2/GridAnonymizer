using System.Reflection;
using System.Text.Json;
using GridAnonymizer.Formats.Cim;
using GridAnonymizer.Formats.Psse;
using GridAnonymizer.Formats.Text;
using GridAnonymizer.Hashing;
using GridAnonymizer.Mapping;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Engine;

/// <summary>The formats this build understands. Add a handler here to support a new one.</summary>
public static class FormatRegistry
{
    public static IReadOnlyList<IFormatHandler> All { get; } = [new CimHandler(), new PsseHandler(), new TextHandler()];

    public static IFormatHandler Get(string id) =>
        All.FirstOrDefault(h => h.Id.Equals(id, StringComparison.OrdinalIgnoreCase))
        ?? throw new ArgumentException($"Unknown format '{id}'. Known: {string.Join(", ", All.Select(h => h.Id))}");

    /// <summary>Sniff content first, then fall back to the extension. Null when nothing fits.</summary>
    public static IFormatHandler? Detect(string path)
    {
        var head = ReadHead(path);
        foreach (var h in All)
            if (h.Sniff(head)) return h;
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return All.FirstOrDefault(h => h.Extensions.Contains(ext));
    }

    private static string ReadHead(string path)
    {
        using var r = new StreamReader(path, FileUtil.Utf8NoBom, detectEncodingFromByteOrderMarks: true);
        var buf = new char[16 * 1024];
        var n = r.ReadBlock(buf, 0, buf.Length);
        return new string(buf, 0, n);
    }
}

public sealed record InputFile(string Path, IFormatHandler Format);

public sealed class EngineOptions
{
    public AnonymizationProfile Profile { get; init; } = new();
    public string? Salt { get; init; }
    public MappingDocument? Mapping { get; init; }
    public bool Audit { get; init; } = true;
    public string OutputSuffix { get; init; } = "_anonymized";
    public Action<string>? Log { get; init; }

    /// <summary>Structured progress for UIs: (stage, file name, files done, files total).</summary>
    public Action<string, string, int, int>? Progress { get; init; }
}

public sealed class RunResult
{
    public required RunReport Report { get; init; }
    public required MappingDocument Mapping { get; init; }
    public required string Salt { get; init; }
    public bool SaltWasGenerated { get; init; }
}

/// <summary>
/// Orchestrates a run: groups inputs by format, scans every file of a group
/// before rewriting any (so a multi-file set shares one mapping), then audits
/// each output. Structured formats run before plain text so companion files
/// can reuse the names they just mapped.
/// </summary>
public sealed class AnonymizerEngine(EngineOptions options)
{
    public static string ToolVersion =>
        "gridanon " + (typeof(AnonymizerEngine).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "dev");

    public RunResult Anonymize(IReadOnlyList<InputFile> inputs, string outputDirectory) => Run(inputs, outputDirectory, restore: false);

    public RunResult Restore(IReadOnlyList<InputFile> inputs, string outputDirectory) => Run(inputs, outputDirectory, restore: true);

    private RunResult Run(IReadOnlyList<InputFile> inputs, string outputDirectory, bool restore)
    {
        if (restore && options.Mapping is null) throw new InvalidOperationException("restore requires a mapping file");
        var generated = options.Salt is null && options.Mapping is null;
        var salt = options.Salt ?? options.Mapping?.Salt ?? Pseudonym.NewSalt();
        if (options.Mapping is not null && options.Salt is not null && options.Mapping.Salt.Length > 0 && options.Mapping.Salt != options.Salt)
            throw new InvalidOperationException("--salt differs from the salt stored in the mapping file; pass only one of them.");

        var mapping = new MappingDocument
        {
            Tool = ToolVersion,
            Salt = salt,
            Profile = options.Profile.Name,
            Sources = [.. (options.Mapping?.Sources ?? []).Union(inputs.Select(i => Path.GetFileName(i.Path)))],
        };
        if (options.Mapping is not null) Merge(options.Mapping, mapping);

        var report = new RunReport { Tool = ToolVersion, Mode = restore ? "restore" : "anonymize", Profile = options.Profile.Name };
        var suffix = restore ? "_restored" : options.OutputSuffix;

        var done = 0;
        var groups = inputs.GroupBy(i => i.Format.Id)
            .OrderBy(g => g.Key == "text" ? 1 : 0)
            .ToList();

        foreach (var group in groups)
        {
            var handler = group.First().Format;
            var ctx = new JobContext
            {
                Profile = options.Profile,
                Salt = salt,
                Restore = restore,
                // text jobs see everything mapped so far in this run
                Mapping = handler.Id == "text" || restore ? mapping : options.Mapping,
            };
            var job = handler.CreateJob(ctx);
            var files = group.ToList();

            var clock = System.Diagnostics.Stopwatch.StartNew();
            foreach (var f in files)
            {
                options.Log?.Invoke($"scan     {Path.GetFileName(f.Path)} [{handler.Id}]");
                options.Progress?.Invoke("scanning", Path.GetFileName(f.Path), done, inputs.Count);
                job.Scan(f.Path);
            }
            options.Log?.Invoke($"         scanned in {clock.Elapsed.TotalSeconds:F1}s");
            clock.Restart();
            job.BuildMaps();
            options.Log?.Invoke($"         mapped in {clock.Elapsed.TotalSeconds:F1}s");

            foreach (var f in files)
            {
                var output = OutputPathFor(f.Path, outputDirectory, suffix);
                if (Path.GetFullPath(output).Equals(Path.GetFullPath(f.Path), StringComparison.OrdinalIgnoreCase))
                    throw new IOException($"Refusing to overwrite the input file {f.Path}");
                options.Log?.Invoke($"{(restore ? "restore " : "rewrite ")} {Path.GetFileName(f.Path)} -> {Path.GetFileName(output)}");
                clock.Restart();
                options.Progress?.Invoke(restore ? "restoring" : "rewriting", Path.GetFileName(f.Path), done, inputs.Count);
                var fr = job.Rewrite(f.Path, output);
                options.Log?.Invoke($"         rewritten in {clock.Elapsed.TotalSeconds:F1}s");
                if (options.Audit && !restore)
                {
                    options.Log?.Invoke($"audit    {Path.GetFileName(output)}");
                    options.Progress?.Invoke("auditing", Path.GetFileName(f.Path), done, inputs.Count);
                    clock.Restart();
                    fr.Audit = job.Audit(f.Path, output);
                    options.Log?.Invoke($"         audited in {clock.Elapsed.TotalSeconds:F1}s");
                }
                report.Files.Add(fr);
                done++;
            }
            job.ExportTo(mapping);
        }

        return new RunResult { Report = report, Mapping = mapping, Salt = salt, SaltWasGenerated = generated };
    }

    /// <summary>Audit an anonymized file against its original without rewriting anything.</summary>
    public AuditResult Audit(string originalPath, string anonymizedPath, IFormatHandler format)
    {
        var ctx = new JobContext { Profile = options.Profile, Salt = options.Salt ?? options.Mapping?.Salt ?? "", Mapping = options.Mapping };
        var job = format.CreateJob(ctx);
        job.Scan(originalPath);
        job.BuildMaps();
        return job.Audit(originalPath, anonymizedPath);
    }

    public static string OutputPathFor(string input, string outputDirectory, string suffix)
    {
        var name = Path.GetFileNameWithoutExtension(input);
        var ext = Path.GetExtension(input);
        return Path.Combine(outputDirectory, name + suffix + ext);
    }

    private static void Merge(MappingDocument from, MappingDocument to)
    {
        foreach (var p in from.Cim.Ids) to.Cim.Ids[p.Key] = p.Value;
        foreach (var p in from.Cim.Names) to.Cim.Names[p.Key] = p.Value;
        foreach (var p in from.Cim.Mrids) to.Cim.Mrids[p.Key] = p.Value;
        foreach (var p in from.Cim.Descriptions) to.Cim.Descriptions[p.Key] = p.Value;
        to.Cim.Preserved = [.. from.Cim.Preserved];
        foreach (var p in from.Psse.Names) to.Psse.Names[p.Key] = p.Value;
        foreach (var p in from.Psse.Buses) to.Psse.Buses[p.Key] = p.Value;
    }
}

/// <summary>Loads profiles from JSON, falling back to built-in defaults for omitted fields.</summary>
public static class ProfileLoader
{
    public static AnonymizationProfile Load(string path)
    {
        using var s = File.OpenRead(path);
        return JsonSerializer.Deserialize(s, GridAnonymizerJsonContext.Default.AnonymizationProfile)
               ?? throw new InvalidDataException($"{path}: empty profile");
    }

    public static AnonymizationProfile Parse(string json) =>
        JsonSerializer.Deserialize(json, GridAnonymizerJsonContext.Default.AnonymizationProfile)
        ?? throw new InvalidDataException("empty profile");

    public static string DefaultJson() =>
        JsonSerializer.Serialize(new AnonymizationProfile(), GridAnonymizerJsonContext.Default.AnonymizationProfile);
}
