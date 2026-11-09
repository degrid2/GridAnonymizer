using System.Text.Json;
using System.Text.Json.Serialization;
using GridAnonymizer.Engine;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Mapping;

/// <summary>
/// The private key to an anonymized model set: the salt plus every
/// original-to-pseudonym pair. Load it with <c>--use-mapping</c> to anonymize a
/// later revision consistently, or with <c>gridanon restore</c> to translate
/// results that come back from a third party.
/// </summary>
public sealed class MappingDocument
{
    public const string CurrentFormat = "gridanon-mapping/1";

    public string Format { get; set; } = CurrentFormat;
    public string Warning { get; set; } =
        "PRIVATE - this file reverses the anonymization. Never publish it alongside the anonymized model.";
    public string? Tool { get; set; }
    public DateTimeOffset Created { get; set; } = DateTimeOffset.UtcNow;
    public string Salt { get; set; } = "";
    public string? Profile { get; set; }
    public List<string> Sources { get; set; } = [];
    public CimMapping Cim { get; set; } = new();
    public PsseMapping Psse { get; set; } = new();

    public static MappingDocument Load(string path)
    {
        using var s = File.OpenRead(path);
        var doc = JsonSerializer.Deserialize(s, GridAnonymizerJsonContext.Default.MappingDocument)
                  ?? throw new InvalidDataException($"{path}: empty mapping file");
        if (doc.Format != CurrentFormat)
            throw new InvalidDataException($"{path}: unsupported mapping format '{doc.Format}' (expected {CurrentFormat})");
        return doc;
    }

    public static MappingDocument Parse(string json, string source = "mapping")
    {
        var doc = JsonSerializer.Deserialize(json, GridAnonymizerJsonContext.Default.MappingDocument)
                  ?? throw new InvalidDataException($"{source}: empty mapping file");
        if (doc.Format != CurrentFormat)
            throw new InvalidDataException($"{source}: unsupported mapping format '{doc.Format}' (expected {CurrentFormat})");
        return doc;
    }

    public string ToJson() => JsonSerializer.Serialize(this, GridAnonymizerJsonContext.Default.MappingDocument);

    public void Save(string path)
    {
        using var s = File.Create(path);
        JsonSerializer.Serialize(s, this, GridAnonymizerJsonContext.Default.MappingDocument);
    }

    /// <summary>All original→pseudonym name/id pairs, for rewriting companion text files.</summary>
    public IEnumerable<KeyValuePair<string, string>> AllTextPairs()
    {
        foreach (var p in Cim.Names) yield return p;
        foreach (var p in Cim.Ids) yield return p;
        foreach (var p in Cim.Mrids) yield return p;
        foreach (var p in Psse.Names) yield return p;
    }
}

public sealed class CimMapping
{
    public Dictionary<string, string> Ids { get; set; } = [];
    public Dictionary<string, string> Names { get; set; } = [];
    public Dictionary<string, string> Mrids { get; set; } = [];
    public Dictionary<string, string> Descriptions { get; set; } = [];
    public List<string> Preserved { get; set; } = [];
}

public sealed class PsseMapping
{
    public Dictionary<string, string> Names { get; set; } = [];
    /// <summary>Original bus number → new bus number (only when renumbering).</summary>
    public Dictionary<string, int> Buses { get; set; } = [];
}

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = true,
    AllowTrailingCommas = true,
    ReadCommentHandling = JsonCommentHandling.Skip,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    UseStringEnumConverter = true)]
[JsonSerializable(typeof(MappingDocument))]
[JsonSerializable(typeof(AnonymizationProfile))]
[JsonSerializable(typeof(RunReport))]
public sealed partial class GridAnonymizerJsonContext : JsonSerializerContext;
