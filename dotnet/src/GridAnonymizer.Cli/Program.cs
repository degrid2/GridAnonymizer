using System.Text.Json;
using GridAnonymizer.Cli;
using GridAnonymizer.Engine;
using GridAnonymizer.IO;
using GridAnonymizer.Mapping;
using GridAnonymizer.Profiles;

return Cli.Run(args);

namespace GridAnonymizer.Cli
{
    internal static class ExitCodes
    {
        public const int Ok = 0;
        public const int Error = 1;
        public const int AuditFailed = 2;
    }

    internal static class Cli
    {
        private const string Usage = """
            gridanon - anonymize power-system network models on your own machine.

            USAGE
              gridanon anonymize <files|dirs...> [options]   rewrite models with pseudonyms, then audit the output
              gridanon restore   <files|dirs...> --mapping <file> [options]
                                                           translate anonymized names/ids/buses back
              gridanon audit     <original> <anonymized> [--format F] [--profile P]
              gridanon ui        [-o <dir>] [--port N] [--no-browser]
                                                           open the GridAnonymizer page in your browser, served from this
                                                           computer only (127.0.0.1); results are written to <dir>
              gridanon profile   init [file]               write the default profile (to stdout without a file)
              gridanon formats                             list supported formats
              gridanon version

            ANONYMIZE OPTIONS
              -o, --out <dir>          output directory (default: ./anonymized)
              -p, --profile <file>     JSON profile (see `gridanon profile init`)
                  --salt <text>        secret salt; same salt => same pseudonyms across runs
                  --salt-env <VAR>     read the salt from an environment variable
              -m, --mapping <file>     write the PRIVATE reversible mapping here
                  --use-mapping <file> continue an earlier mapping (consistent ids for a new model revision)
              -f, --format <id>        force a format: cim | psse | psse-aux | text (default: detect per file)
                  --renumber-buses     PSS/E: renumber buses everywhere they are referenced
                  --keep-comments      keep XML comments / RAW '/' comments
                  --keep-titles        PSS/E: keep the two case-title lines
                  --redact <term>      a term that must never survive (repeatable), e.g. your utility's name
                  --zip <file>         put every output into one zip (a .zip input always gives <name>_anonymized.zip)
                  --report <file>      write a JSON report of the run
                  --no-audit           skip the post-run leak audit
              -r, --recursive          descend into directories
              -q, --quiet              only print problems

            EXIT CODES
              0 success   1 error   2 the audit found something identifying in the output

            EXAMPLES
              gridanon anonymize EQ.xml SSH.xml TP.xml SV.xml -m private/map.json
              gridanon anonymize case.raw --renumber-buses --redact "Meridian Power" -m map.json
              gridanon anonymize case_2027.raw --use-mapping map.json -m map_2027.json
              gridanon restore vendor_results.csv --mapping map.json
            """;

        public static int Run(string[] args)
        {
            try
            {
                if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
                {
                    Console.WriteLine(Usage);
                    return args.Length == 0 ? ExitCodes.Error : ExitCodes.Ok;
                }
                var a = new Args(args[1..]);
                return args[0] switch
                {
                    "anonymize" or "anon" => Anonymize(a, restore: false),
                    "restore" => Anonymize(a, restore: true),
                    "audit" => Audit(a),
                    "ui" => RunUi(a),
                    "profile" => Profile(a),
                    "formats" => Formats(),
                    "version" or "--version" or "-v" => Print(AnonymizerEngine.ToolVersion),
                    _ => throw new UsageException($"Unknown command '{args[0]}'. Run `gridanon --help`."),
                };
            }
            catch (UsageException e)
            {
                Console.Error.WriteLine("error: " + e.Message);
                return ExitCodes.Error;
            }
            catch (Exception e) when (e is IOException or InvalidDataException or InvalidOperationException
                                          or NotSupportedException or UnauthorizedAccessException or JsonException
                                          or ArgumentException)
            {
                Console.Error.WriteLine("error: " + e.Message);
                return ExitCodes.Error;
            }
        }

        private static int Print(string s)
        {
            Console.WriteLine(s);
            return ExitCodes.Ok;
        }

        private static int RunUi(Args a)
        {
            var outDir = a.Value("-o", "--out") ?? "gridanon-output";
            var portText = a.Value("--port");
            var noBrowser = a.Flag("--no-browser");
            a.EnsureNoUnknown();
            var port = 0;
            if (portText is not null && (!int.TryParse(portText, out port) || port is < 1 or > 65535))
                throw new UsageException("--port must be a number between 1 and 65535");

            using var server = new Ui.UiServer(outDir, port);
            using var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
            var run = server.RunAsync(cts.Token);
            Console.WriteLine($"GridAnonymizer UI: {server.Url}");
            Console.WriteLine($"results are written to {server.OutputDir}");
            Console.WriteLine("listening on this computer only; press Ctrl+C to stop.");
            if (!noBrowser) Ui.UiServer.OpenBrowser(server.Url);
            run.GetAwaiter().GetResult();
            return ExitCodes.Ok;
        }

        private static int Formats()
        {
            foreach (var h in FormatRegistry.All)
                Console.WriteLine($"  {h.Id,-8} {h.Description}  [{string.Join(" ", h.Extensions)}]");
            return ExitCodes.Ok;
        }

        private static int Profile(Args a)
        {
            var sub = a.Positional.FirstOrDefault() ?? "init";
            if (sub != "init") throw new UsageException("usage: gridanon profile init [file]");
            var json = ProfileLoader.DefaultJson();
            var file = a.Positional.Skip(1).FirstOrDefault();
            if (file is null) Console.WriteLine(json);
            else
            {
                if (File.Exists(file)) throw new IOException($"{file} already exists");
                File.WriteAllText(file, json);
                Console.WriteLine($"wrote {file}");
            }
            return ExitCodes.Ok;
        }

        private static AnonymizationProfile LoadProfile(Args a)
        {
            var path = a.Value("-p", "--profile");
            var profile = path is null ? new AnonymizationProfile() : ProfileLoader.Load(path);
            if (a.Flag("--renumber-buses")) profile.Psse.RenumberBuses = true;
            if (a.Flag("--keep-comments")) { profile.Cim.StripComments = false; profile.Psse.StripComments = false; }
            if (a.Flag("--keep-titles")) profile.Psse.ReplaceCaseTitle = false;
            profile.RedactTerms.AddRange(a.Values("--redact"));
            return profile;
        }

        private static int Anonymize(Args a, bool restore)
        {
            var quiet = a.Flag("-q", "--quiet");
            var profile = LoadProfile(a);
            var outDir = a.Value("-o", "--out") ?? (restore ? "restored" : "anonymized");
            var mappingIn = restore ? a.Value("-m", "--mapping", "--use-mapping") : a.Value("--use-mapping");
            var mappingOut = restore ? null : a.Value("-m", "--mapping");
            var salt = a.Value("--salt");
            if (a.Value("--salt-env") is { } envVar)
                salt = Environment.GetEnvironmentVariable(envVar) ?? throw new UsageException($"environment variable {envVar} is not set");
            var forced = a.Value("-f", "--format");
            var reportPath = a.Value("--report");
            var zipOut = a.Value("--zip");
            var recursive = a.Flag("-r", "--recursive");
            var noAudit = a.Flag("--no-audit");
            a.EnsureNoUnknown();

            if (restore && mappingIn is null) throw new UsageException("restore needs --mapping <file>");
            if (a.Positional.Count == 0) throw new UsageException("no input files");
            if (mappingOut is not null && mappingIn is not null && Path.GetFullPath(mappingOut) == Path.GetFullPath(mappingIn))
                throw new UsageException("write the updated mapping to a new file rather than over --use-mapping");

            var work = Path.Combine(Path.GetTempPath(), "gridanon-" + Guid.NewGuid().ToString("N")[..12]);
            try
            {
                return RunWithBundles(a, restore, quiet, profile, outDir, mappingIn, mappingOut, salt, forced, reportPath, zipOut, recursive, noAudit, work);
            }
            finally
            {
                // Extracted zip entries are copies of the user's models: never leave them behind.
                if (Directory.Exists(work)) Directory.Delete(work, recursive: true);
            }
        }

        private static int RunWithBundles(Args a, bool restore, bool quiet, AnonymizationProfile profile, string outDir, string? mappingIn,
            string? mappingOut, string? salt, string? forced, string? reportPath, string? zipOut, bool recursive, bool noAudit, string work)
        {
            var planned = InputExpander.Expand(a.Positional, recursive, forced, work);
            if (planned.Count == 0) throw new UsageException("no recognizable input files (use --format to force one)");
            var inputs = planned.Select(p => p.Input).ToList();
            var staging = zipOut is not null || planned.Any(p => p.Bundle is not null);
            var engineOut = staging ? Path.Combine(work, "out") : outDir;

            var mapping = mappingIn is null ? null : MappingDocument.Load(mappingIn);
            var engine = new AnonymizerEngine(new EngineOptions
            {
                Profile = profile,
                Salt = salt,
                Mapping = mapping,
                Audit = !noAudit,
                Log = quiet ? null : s => Console.Error.WriteLine("  " + s),
            });

            var result = restore ? engine.Restore(inputs, engineOut) : engine.Anonymize(inputs, engineOut);
            if (staging) Bundles.Package(result.Report, planned, outDir, zipOut, restore ? "_restored" : "_anonymized");

            if (mappingOut is not null)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(mappingOut))!);
                result.Mapping.Save(mappingOut);
            }
            if (reportPath is not null)
                File.WriteAllText(reportPath, JsonSerializer.Serialize(result.Report, GridAnonymizerJsonContext.Default.RunReport));

            PrintSummary(result, quiet, mappingOut, restore);
            return result.Report.Clean ? ExitCodes.Ok : ExitCodes.AuditFailed;
        }

        private static void PrintSummary(RunResult result, bool quiet, string? mappingOut, bool restore)
        {
            foreach (var f in result.Report.Files)
            {
                var stats = string.Join("  ", f.Stats.Where(s => s.Key != "revision").Select(s => $"{s.Key}={s.Value:N0}"));
                if (!quiet || f.Audit is { Clean: false })
                {
                    Console.WriteLine($"{Path.GetFileName(f.Input)} -> {f.Output}  ({Bytes(f.BytesIn)} -> {Bytes(f.BytesOut)}, {f.Format})");
                    if (stats.Length > 0) Console.WriteLine("    " + stats);
                }
                foreach (var w in f.Warnings) Console.WriteLine("    warning: " + w);
                if (f.Audit is { } au)
                {
                    if (au.Clean)
                    {
                        if (!quiet) Console.WriteLine($"    audit: clean - 0 of {au.Hunted:N0} identifying values found ({au.VocabularyExcluded:N0} shared labels deliberately kept)");
                    }
                    else
                    {
                        Console.WriteLine("    AUDIT FAILED - do not share this file.");
                        if (au.LeakedNames.Count > 0) Console.WriteLine("      names: " + string.Join(", ", au.LeakedNames));
                        if (au.LeakedIds.Count > 0) Console.WriteLine("      ids:   " + string.Join(", ", au.LeakedIds));
                        if (au.LeakedTerms.Count > 0) Console.WriteLine("      terms: " + string.Join(", ", au.LeakedTerms));
                        foreach (var i in au.IntegrityIssues) Console.WriteLine("      integrity: " + i);
                    }
                }
            }

            if (restore) return;
            if (mappingOut is not null)
                Console.WriteLine($"mapping written to {mappingOut} - PRIVATE: it reverses the anonymization.");
            if (result.SaltWasGenerated)
            {
                Console.WriteLine($"salt: {result.Salt}");
                if (mappingOut is null)
                    Console.WriteLine("      keep it secret; reuse it with --salt to anonymize related files consistently.");
            }
        }

        private static string Bytes(long n) => n switch
        {
            >= 1_000_000_000 => $"{n / 1e9:F2} GB",
            >= 1_000_000 => $"{n / 1e6:F1} MB",
            _ => $"{n / 1e3:F0} KB",
        };

        private static int Audit(Args a)
        {
            var profile = LoadProfile(a);
            var forced = a.Value("-f", "--format");
            var mappingPath = a.Value("-m", "--mapping");
            a.EnsureNoUnknown();
            if (a.Positional.Count != 2) throw new UsageException("usage: gridanon audit <original> <anonymized>");
            var (orig, anon) = (a.Positional[0], a.Positional[1]);
            var format = forced is not null ? FormatRegistry.Get(forced)
                : FormatRegistry.Detect(orig) ?? throw new UsageException($"cannot detect the format of {orig}; use --format");
            var engine = new AnonymizerEngine(new EngineOptions
            {
                Profile = profile,
                Mapping = mappingPath is null ? null : MappingDocument.Load(mappingPath),
            });
            var r = engine.Audit(orig, anon, format);
            Console.WriteLine(r.Clean
                ? $"clean - 0 of {r.Hunted:N0} identifying values from {Path.GetFileName(orig)} found in {Path.GetFileName(anon)}"
                : $"LEAKS FOUND: names [{string.Join(", ", r.LeakedNames)}] ids [{string.Join(", ", r.LeakedIds)}] terms [{string.Join(", ", r.LeakedTerms)}] {string.Join("; ", r.IntegrityIssues)}");
            return r.Clean ? ExitCodes.Ok : ExitCodes.AuditFailed;
        }
    }

    internal sealed class UsageException(string message) : Exception(message);

    /// <summary>Tiny argument parser: no dependency on System.CommandLine, trimming- and AOT-safe.</summary>
    internal sealed class Args
    {
        private readonly List<(string Name, string? Value)> _options = [];
        private readonly HashSet<string> _consumed = [];
        public List<string> Positional { get; } = [];

        private static readonly HashSet<string> Flags =
        [
            "--renumber-buses", "--keep-comments", "--keep-titles", "--no-audit", "-r", "--recursive", "-q", "--quiet", "--no-browser",
        ];

        public Args(string[] args)
        {
            for (var i = 0; i < args.Length; i++)
            {
                var s = args[i];
                if (s == "--") { Positional.AddRange(args[(i + 1)..]); break; }
                if (s.StartsWith('-') && s.Length > 1)
                {
                    var eq = s.IndexOf('=');
                    if (eq > 0) { _options.Add((s[..eq], s[(eq + 1)..])); continue; }
                    if (Flags.Contains(s)) { _options.Add((s, null)); continue; }
                    if (i + 1 >= args.Length) throw new UsageException($"{s} needs a value");
                    _options.Add((s, args[++i]));
                    continue;
                }
                Positional.Add(s);
            }
        }

        public bool Flag(params string[] names)
        {
            foreach (var n in names) _consumed.Add(n);
            return _options.Exists(o => names.Contains(o.Name));
        }

        public string? Value(params string[] names)
        {
            foreach (var n in names) _consumed.Add(n);
            return _options.LastOrDefault(o => names.Contains(o.Name)).Value;
        }

        public IEnumerable<string> Values(string name)
        {
            _consumed.Add(name);
            return _options.Where(o => o.Name == name && o.Value is not null).Select(o => o.Value!);
        }

        public void EnsureNoUnknown()
        {
            var unknown = _options.Select(o => o.Name).FirstOrDefault(n => !_consumed.Contains(n));
            if (unknown is not null) throw new UsageException($"unknown option {unknown}");
        }
    }

    /// <summary>An input file, and where it came from when it was inside a zip.</summary>
    internal sealed record PlannedInput(InputFile Input, string? Bundle, string EntryPath);

    internal static class InputExpander
    {
        public static List<PlannedInput> Expand(IEnumerable<string> patterns, bool recursive, string? forcedFormat, string work)
        {
            var forced = forcedFormat is null ? null : FormatRegistry.Get(forcedFormat);
            var result = new List<PlannedInput>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var zips = 0;

            IFormatHandler? FormatOf(string full, string shown, bool explicitlyNamed)
            {
                var fmt = forced ?? FormatRegistry.Detect(full);
                if (fmt is null && explicitlyNamed) Console.Error.WriteLine($"  skip     {shown}: unknown format (use --format)");
                return fmt;
            }

            void Add(string path, bool explicitlyNamed)
            {
                var full = Path.GetFullPath(path);
                if (!seen.Add(full)) return;
                if (full.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    var k = ++zips;
                    var dest = Path.Combine(work, "in", k.ToString());
                    foreach (var e in ZipBundle.Extract(full, dest))
                    {
                        if (FormatOf(e.FullPath, $"{Path.GetFileName(full)}!{e.RelativePath}", true) is not { } zf) continue;
                        var dir = Path.GetDirectoryName(e.RelativePath) ?? "";
                        result.Add(new PlannedInput(new InputFile(e.FullPath, zf, Path.Combine("zip" + k, dir)), full, e.RelativePath));
                    }
                    return;
                }
                if (FormatOf(full, path, explicitlyNamed) is not { } fmt) return;
                result.Add(new PlannedInput(new InputFile(full, fmt), null, Path.GetFileName(full)));
            }

            foreach (var p in patterns)
            {
                if (Directory.Exists(p))
                {
                    var opt = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
                    foreach (var f in Directory.EnumerateFiles(p, "*", opt).Order(StringComparer.Ordinal)) Add(f, false);
                }
                else if (p.Contains('*') || p.Contains('?'))
                {
                    var dir = Path.GetDirectoryName(p) is { Length: > 0 } d ? d : ".";
                    foreach (var f in Directory.EnumerateFiles(dir, Path.GetFileName(p)).Order(StringComparer.Ordinal)) Add(f, true);
                }
                else if (File.Exists(p)) Add(p, true);
                else throw new FileNotFoundException($"input not found: {p}");
            }
            return result;
        }
    }

    /// <summary>
    /// Turns staged outputs into what the user asked for: a .zip input becomes
    /// &lt;name&gt;_anonymized.zip with the original layout and file names inside;
    /// --zip puts everything into one archive; other files are moved to the output folder.
    /// </summary>
    internal static class Bundles
    {
        public static void Package(RunReport report, List<PlannedInput> planned, string outDir, string? zipOut, string suffix)
        {
            var byInput = planned.ToDictionary(p => p.Input.Path, StringComparer.OrdinalIgnoreCase);
            var bundles = planned.Where(p => p.Bundle is not null).Select(p => p.Bundle!).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            Directory.CreateDirectory(outDir);

            string EntryName(PlannedInput p) =>
                p.Bundle is not null && bundles.Count > 1 && zipOut is not null
                    ? Path.GetFileNameWithoutExtension(p.Bundle) + "/" + p.EntryPath
                    : p.EntryPath;

            var outputs = report.Files.Where(f => f.Output is not null && byInput.ContainsKey(f.Input)).ToList();

            if (zipOut is not null)
            {
                var entries = outputs.Select(f => (Name: EntryName(byInput[f.Input]), File: f)).ToList();
                ZipBundle.Write(zipOut, entries.Select(e => (e.Name, e.File.Output!)));
                foreach (var (name, f) in entries) f.Output = $"{zipOut}!{name}";
                return;
            }

            foreach (var bundle in bundles)
            {
                var target = Path.Combine(outDir, Path.GetFileNameWithoutExtension(bundle) + suffix + ".zip");
                var mine = outputs.Where(f => string.Equals(byInput[f.Input].Bundle, bundle, StringComparison.OrdinalIgnoreCase)).ToList();
                ZipBundle.Write(target, mine.Select(f => (byInput[f.Input].EntryPath, f.Output!)));
                foreach (var f in mine) f.Output = $"{target}!{byInput[f.Input].EntryPath}";
            }
            foreach (var f in outputs.Where(f => byInput[f.Input].Bundle is null))
            {
                var dest = Path.Combine(outDir, Path.GetFileName(f.Output!));
                File.Move(f.Output!, dest, overwrite: true);
                f.Output = dest;
            }
        }
    }
}
