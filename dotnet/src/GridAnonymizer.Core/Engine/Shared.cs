using System.Text;
using System.Text.RegularExpressions;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Engine;

/// <summary>Profile-level rules that apply to every format.</summary>
public sealed class GlobalRules
{
    private readonly Regex[] _preserve;
    private readonly Regex? _redact;
    public string RedactionText { get; }
    public IReadOnlyList<string> RedactTerms { get; }

    public GlobalRules(AnonymizationProfile profile)
    {
        _preserve = [.. profile.PreserveNames.Select(p => new Regex(p, RegexOptions.CultureInvariant))];
        RedactTerms = [.. profile.RedactTerms.Where(t => !string.IsNullOrWhiteSpace(t))];
        RedactionText = profile.RedactionText;
        if (RedactTerms.Count > 0)
        {
            var alt = string.Join("|", RedactTerms.OrderByDescending(t => t.Length).Select(Regex.Escape));
            _redact = new Regex(alt, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }
    }

    public bool IsPreserved(string name) => _preserve.Length > 0 && Array.Exists(_preserve, r => r.IsMatch(name));

    public bool HasRedactions => _redact is not null;

    public string Redact(string text, FileReport? report = null)
    {
        if (_redact is null) return text;
        return _redact.Replace(text, _ =>
        {
            report?.Count("redactions");
            return RedactionText;
        });
    }

    /// <summary>Terms from the profile that appear (case-insensitively) in <paramref name="text"/>.</summary>
    public IEnumerable<string> FindTerms(string text)
    {
        if (_redact is null) yield break;
        foreach (var t in RedactTerms)
            if (text.Contains(t, StringComparison.OrdinalIgnoreCase)) yield return t;
    }
}

internal static class FileUtil
{
    public static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    /// <summary>Write via a temporary file and rename, so a failed run never leaves a half-written model behind.</summary>
    public static void WriteAtomically(string outputPath, Encoding encoding, Action<TextWriter> write)
    {
        var dir = Path.GetDirectoryName(Path.GetFullPath(outputPath))!;
        Directory.CreateDirectory(dir);
        var temp = Path.Combine(dir, "." + Path.GetFileName(outputPath) + ".partial");
        try
        {
            using (var w = new StreamWriter(temp, append: false, encoding, bufferSize: 1 << 16))
            {
                write(w);
            }
            File.Move(temp, outputPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    public static StreamReader OpenText(string path, Encoding encoding) =>
        new(path, encoding, detectEncodingFromByteOrderMarks: true, bufferSize: 1 << 16);

    public static long Size(string path) => new FileInfo(path).Length;

    /// <summary>The input's line ending ("\r\n" or "\n"), so line-based rewrites keep it on every OS.</summary>
    public static string DetectNewLine(string path)
    {
        using var s = File.OpenRead(path);
        var buf = new byte[64 * 1024];
        var n = s.Read(buf, 0, buf.Length);
        var i = Array.IndexOf(buf, (byte)'\n', 0, n);
        return i > 0 && buf[i - 1] == '\r' ? "\r\n" : "\n";
    }
}

/// <summary>Sequential pseudonym generator that never reuses a name already taken.</summary>
internal sealed class NameCounter
{
    private readonly Dictionary<string, int> _counters = [];
    private readonly HashSet<string> _used;

    public NameCounter(IEnumerable<string> alreadyUsed) => _used = [.. alreadyUsed];

    public bool IsUsed(string candidate) => _used.Contains(candidate);
    public void MarkUsed(string candidate) => _used.Add(candidate);

    public int Next(string key)
    {
        var n = _counters.GetValueOrDefault(key) + 1;
        _counters[key] = n;
        return n;
    }

    public string NextName(string prefix, int width = 4, string separator = "_")
    {
        for (; ; )
        {
            var candidate = prefix + separator + Next(prefix).ToString().PadLeft(width, '0');
            if (_used.Add(candidate)) return candidate;
        }
    }
}
