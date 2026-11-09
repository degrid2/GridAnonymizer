using GridAnonymizer.Engine;
using GridAnonymizer.Mapping;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Tests;

internal sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "gridanon-tests", Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public string File(string name) => System.IO.Path.Combine(Path, name);
    public void Dispose()
    {
        try { Directory.Delete(Path, recursive: true); } catch (IOException) { }
    }
}

internal static class Run
{
    public static string Sample(string relative) => Path.Combine(AppContext.BaseDirectory, "samples", relative);
    public static string Data(string name) => Path.Combine(AppContext.BaseDirectory, "TestData", name);

    public static RunResult Anonymize(string outDir, AnonymizationProfile? profile = null, string? salt = "test-salt-123",
        MappingDocument? mapping = null, params string[] files)
    {
        var engine = new AnonymizerEngine(new EngineOptions { Profile = profile ?? new AnonymizationProfile(), Salt = salt, Mapping = mapping });
        return engine.Anonymize([.. files.Select(f => new InputFile(f, FormatRegistry.Detect(f)!))], outDir);
    }

    public static RunResult Restore(string outDir, MappingDocument mapping, params string[] files)
    {
        var engine = new AnonymizerEngine(new EngineOptions { Mapping = mapping });
        return engine.Restore([.. files.Select(f => new InputFile(f, FormatRegistry.Detect(f)!))], outDir);
    }

    public static string Out(string dir, string input, string suffix = "_anonymized") =>
        AnonymizerEngine.OutputPathFor(input, dir, suffix);
}
