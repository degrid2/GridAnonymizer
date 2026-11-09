using System.IO.Compression;

namespace GridAnonymizer.IO;

/// <summary>
/// Zip input and output for model bundles (a PSS/E case with its .con/.mon/.sub
/// files, a CGMES set...). Uses System.IO.Compression from the base class library.
/// </summary>
public static class ZipBundle
{
    public sealed record Entry(string RelativePath, string FullPath);

    /// <summary>
    /// Extract every file of a zip into <paramref name="destination"/>. Entry names
    /// are sanitized: absolute paths and ".." segments are refused (zip slip),
    /// directories and macOS metadata are skipped.
    /// </summary>
    public static List<Entry> Extract(string zipPath, string destination)
    {
        var root = Path.GetFullPath(destination);
        Directory.CreateDirectory(root);
        var result = new List<Entry>();
        using var zip = ZipFile.OpenRead(zipPath);
        foreach (var e in zip.Entries)
        {
            var rel = SafeRelativePath(e.FullName);
            if (rel is null) continue;
            var full = Path.GetFullPath(Path.Combine(root, rel));
            if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                throw new InvalidDataException($"{Path.GetFileName(zipPath)}: entry '{e.FullName}' points outside the archive");
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            e.ExtractToFile(full, overwrite: false);
            result.Add(new Entry(rel, full));
        }
        return result;
    }

    /// <summary>Normalized relative path, or null for entries to skip.</summary>
    public static string? SafeRelativePath(string name)
    {
        var n = name.Replace('\\', '/');
        if (n.Length == 0 || n.EndsWith('/')) return null;                                   // directory
        if (n.StartsWith('/') || (n.Length > 1 && n[1] == ':'))
            throw new InvalidDataException($"zip entry '{name}' has an absolute path");
        var parts = n.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Any(p => p == ".."))
            throw new InvalidDataException($"zip entry '{name}' points outside the archive");
        if (parts[0] == "__MACOSX" || parts[^1] == ".DS_Store" || parts[^1].StartsWith("._", StringComparison.Ordinal)) return null;
        return string.Join('/', parts.Where(p => p != "."));
    }

    /// <summary>Write files into a new zip; entry names use '/' separators.</summary>
    public static void Write(string zipPath, IEnumerable<(string EntryName, string FilePath)> files)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(zipPath))!);
        var temp = zipPath + ".partial";
        try
        {
            using (var zip = ZipFile.Open(temp, ZipArchiveMode.Create))
            {
                foreach (var (name, path) in files)
                    zip.CreateEntryFromFile(path, name.Replace('\\', '/'), CompressionLevel.Optimal);
            }
            File.Move(temp, zipPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }
}
