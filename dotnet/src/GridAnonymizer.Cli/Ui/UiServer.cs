using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using GridAnonymizer.Engine;
using GridAnonymizer.Mapping;

namespace GridAnonymizer.Cli.Ui;

/// <summary>
/// `gridanon ui`: serves the GridAnonymizer page (the same page as the browser
/// edition, embedded from wwwroot/) on the loopback interface and runs the .NET
/// engine behind a small JSON API.
/// </summary>
/// <remarks>
/// Security: listens on localhost only and rejects any connection whose remote
/// address is not loopback; every API call must carry the random per-launch
/// token from the URL the CLI prints; the Host and Origin headers must name this
/// server (defeats DNS rebinding and cross-site requests). Uploaded inputs live
/// in a private temp folder that is deleted when a new set is chosen and on exit.
/// </remarks>
internal sealed class UiServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly Dictionary<string, (byte[] Body, string Type)> _assets;
    private readonly string _token;
    private readonly string _outputDir;
    private readonly string _tempRoot;
    private readonly ConcurrentDictionary<string, Session> _sessions = new();
    private readonly string[] _allowedHosts;

    public int Port { get; }
    public string Url => $"http://localhost:{Port}/?t={_token}";
    public string OutputDir => _outputDir;

    private sealed class Session(string id, string inputDir)
    {
        public string Id { get; } = id;
        public string InputDir { get; } = inputDir;
        public ConcurrentDictionary<string, string> Inputs { get; } = new(StringComparer.Ordinal);   // name → path
        public ConcurrentDictionary<string, string> Outputs { get; } = new(StringComparer.Ordinal);  // name → path
    }

    public UiServer(string outputDir, int port = 0, string? token = null)
    {
        _outputDir = Path.GetFullPath(outputDir);
        _token = token ?? Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        _tempRoot = Path.Combine(Path.GetTempPath(), "gridanon-ui-" + _token[..8]);
        Port = port > 0 ? port : FreePort();
        _allowedHosts = [$"localhost:{Port}", $"127.0.0.1:{Port}"];
        _assets = LoadAssets();
        if (!_assets.ContainsKey("index.html"))
            throw new InvalidOperationException("This build of gridanon has no embedded UI (wwwroot/ was empty at build time).");
        // "localhost" (not 127.0.0.1) so Windows lets a non-administrator register the prefix.
        _listener.Prefixes.Add($"http://localhost:{Port}/");
    }

    private static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    private static Dictionary<string, (byte[], string)> LoadAssets()
    {
        var asm = Assembly.GetExecutingAssembly();
        var map = new Dictionary<string, (byte[], string)>(StringComparer.Ordinal);
        foreach (var name in asm.GetManifestResourceNames())
        {
            var path = name.Replace('\\', '/');
            if (!path.StartsWith("wwwroot/", StringComparison.Ordinal)) continue;
            using var s = asm.GetManifestResourceStream(name)!;
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            map[path["wwwroot/".Length..]] = (ms.ToArray(), ContentType(path));
        }
        return map;
    }

    private static string ContentType(string path) => Path.GetExtension(path) switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };

    private const string Csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
                               "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    public async Task RunAsync(CancellationToken ct)
    {
        _listener.Start();
        using var reg = ct.Register(() => { try { _listener.Stop(); } catch (ObjectDisposedException) { } });
        while (!ct.IsCancellationRequested)
        {
            HttpListenerContext ctx;
            try { ctx = await _listener.GetContextAsync().ConfigureAwait(false); }
            catch (Exception) when (ct.IsCancellationRequested) { break; }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
            _ = Task.Run(() => HandleAsync(ctx), CancellationToken.None);
        }
    }

    private async Task HandleAsync(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        try
        {
            res.Headers["X-Content-Type-Options"] = "nosniff";
            res.Headers["Referrer-Policy"] = "no-referrer";
            res.Headers["Cross-Origin-Opener-Policy"] = "same-origin";
            res.Headers["Content-Security-Policy"] = Csp;
            res.Headers["Cache-Control"] = "no-store";

            if (!IPAddress.IsLoopback(req.RemoteEndPoint.Address)) { await Text(res, 403, "loopback only"); return; }
            if (!_allowedHosts.Contains(req.UserHostName, StringComparer.OrdinalIgnoreCase)) { await Text(res, 421, "unexpected Host header"); return; }

            var path = req.Url!.AbsolutePath;
            if (!path.StartsWith("/api/", StringComparison.Ordinal))
            {
                await Static(req, res, path);
                return;
            }

            var origin = req.Headers["Origin"];
            if (origin is not null && !_allowedHosts.Any(h => origin.Equals("http://" + h, StringComparison.OrdinalIgnoreCase)))
            { await Text(res, 403, "cross-origin request refused"); return; }
            var token = req.Headers["X-GridAnon-Token"] ?? req.QueryString["t"] ?? "";
            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(_token)))
            { await Text(res, 401, "missing or wrong token: open the URL printed by `gridanon ui`"); return; }

            await Api(req, res, path);
        }
        catch (Exception e) when (e is IOException or InvalidDataException or InvalidOperationException or NotSupportedException
                                      or JsonException or ArgumentException or UnauthorizedAccessException or HttpListenerException)
        {
            try { await Text(res, 400, e.Message); } catch (Exception) when (e is not null) { }
        }
        finally
        {
            try { res.Close(); } catch (Exception) when (res is not null) { }
        }
    }

    private async Task Static(HttpListenerRequest req, HttpListenerResponse res, string path)
    {
        if (req.HttpMethod is not ("GET" or "HEAD")) { await Text(res, 405, "method not allowed"); return; }
        var key = path == "/" ? "index.html" : Uri.UnescapeDataString(path.TrimStart('/'));
        if (!_assets.TryGetValue(key, out var asset)) { await Text(res, 404, "not found"); return; }
        res.ContentType = asset.Type;
        res.ContentLength64 = asset.Body.Length;
        if (req.HttpMethod == "GET") await res.OutputStream.WriteAsync(asset.Body);
    }

    private async Task Api(HttpListenerRequest req, HttpListenerResponse res, string path)
    {
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries); // api, ...
        if (parts is ["api", "info"])
        {
            await Json(res, new UiInfo { Version = AnonymizerEngine.ToolVersion, OutputDir = _outputDir }, UiJsonContext.Default.UiInfo);
            return;
        }
        if (parts is ["api", "session"] && req.HttpMethod == "POST")
        {
            foreach (var old in _sessions.Values) DeleteQuietly(old.InputDir);
            _sessions.Clear();
            var id = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8));
            var dir = Path.Combine(_tempRoot, id);
            Directory.CreateDirectory(dir);
            _sessions[id] = new Session(id, dir);
            await Json(res, new UiId { Id = id }, UiJsonContext.Default.UiId);
            return;
        }
        if (parts.Length < 4 || parts[1] != "session" || !_sessions.TryGetValue(parts[2], out var session))
        { await Text(res, 404, "unknown session"); return; }

        switch (parts[3])
        {
            case "file" when req.HttpMethod == "PUT":
                {
                    var name = SafeName(req.QueryString["name"] ?? "");
                    var unique = name;
                    for (var i = 2; session.Inputs.ContainsKey(unique); i++)
                        unique = Path.GetFileNameWithoutExtension(name) + $" ({i})" + Path.GetExtension(name);
                    var target = Path.Combine(session.InputDir, unique);
                    await using (var fs = File.Create(target)) await req.InputStream.CopyToAsync(fs);
                    session.Inputs[unique] = target;
                    await Json(res, new UiId { Name = unique }, UiJsonContext.Default.UiId);
                    return;
                }
            case "detect" when req.HttpMethod == "POST":
                {
                    var body = await JsonSerializer.DeserializeAsync(req.InputStream, UiJsonContext.Default.UiDetectRequest) ?? new();
                    var ids = body.Names.Select(n => n is not null && session.Inputs.TryGetValue(n, out var p) ? FormatRegistry.Detect(p)?.Id : null).ToList();
                    await Json(res, ids, UiJsonContext.Default.ListString);
                    return;
                }
            case "run" when req.HttpMethod == "POST":
                {
                    var body = await JsonSerializer.DeserializeAsync(req.InputStream, UiJsonContext.Default.UiRunRequest) ?? new();
                    await Run(session, body, res);
                    return;
                }
            case "download" when req.HttpMethod == "GET" && parts.Length == 5:
                {
                    var name = Uri.UnescapeDataString(parts[4]);
                    if (!session.Outputs.TryGetValue(name, out var file) || !File.Exists(file)) { await Text(res, 404, "no such output"); return; }
                    res.ContentType = "application/octet-stream";
                    res.AddHeader("Content-Disposition", $"attachment; filename=\"{name.Replace("\"", "", StringComparison.Ordinal)}\"");
                    await using var fs = File.OpenRead(file);
                    res.ContentLength64 = fs.Length;
                    await fs.CopyToAsync(res.OutputStream);
                    return;
                }
        }
        await Text(res, 404, "not found");
    }

    private async Task Run(Session session, UiRunRequest r, HttpListenerResponse res)
    {
        res.ContentType = "application/x-ndjson; charset=utf-8";
        res.SendChunked = true;
        var output = res.OutputStream;
        var gate = new SemaphoreSlim(1, 1);

        async Task Send<T>(T message, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> info)
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(message, info);
            await gate.WaitAsync();
            try
            {
                await output.WriteAsync(bytes);
                await output.WriteAsync("\n"u8.ToArray());
                await output.FlushAsync();
            }
            finally { gate.Release(); }
        }

        try
        {
            var restore = r.Mode == "restore";
            var profile = ProfileLoader.Parse(string.IsNullOrWhiteSpace(r.ProfileJson) ? ProfileLoader.DefaultJson() : r.ProfileJson);
            if (r.Overrides.RenumberBuses) profile.Psse.RenumberBuses = true;
            if (r.Overrides.KeepComments) { profile.Cim.StripComments = false; profile.Psse.StripComments = false; }
            if (r.Overrides.KeepTitles) profile.Psse.ReplaceCaseTitle = false;
            if (r.Overrides.KeepTypeHints) profile.Cim.KeepTypeHints = true;
            profile.RedactTerms.AddRange(r.Overrides.RedactTerms);

            var inputs = new List<InputFile>();
            for (var i = 0; i < r.Names.Count; i++)
            {
                var name = r.Names[i];
                if (name is null || !session.Inputs.TryGetValue(name, out var path)) continue;
                var id = i < r.Formats.Count ? r.Formats[i] : null;
                if (id == "skip") continue;
                var fmt = id is not null ? FormatRegistry.Get(id) : FormatRegistry.Detect(path);
                if (fmt is not null) inputs.Add(new InputFile(path, fmt));
            }
            if (inputs.Count == 0) throw new InvalidOperationException("None of these files is in a recognized format.");

            var progress = new List<Task>();
            var engine = new AnonymizerEngine(new EngineOptions
            {
                Profile = profile,
                Salt = restore || string.IsNullOrWhiteSpace(r.Salt) ? null : r.Salt,
                Mapping = string.IsNullOrWhiteSpace(r.MappingJson) ? null : MappingDocument.Parse(r.MappingJson),
                Progress = (stage, file, index, total) =>
                    progress.Add(Send(new UiProgress { Stage = stage, File = file, Index = index, Total = total }, UiJsonContext.Default.UiProgress)),
            });
            Directory.CreateDirectory(_outputDir);
            var result = await Task.Run(() => restore ? engine.Restore(inputs, _outputDir) : engine.Anonymize(inputs, _outputDir));
            await Task.WhenAll(progress);

            foreach (var f in result.Report.Files)
            {
                var name = Path.GetFileName(f.Output!);
                session.Outputs[name] = f.Output!;
                await Send(new UiFileDone
                {
                    Report = f,
                    File = new UiProducedFile { Name = name, Url = $"/api/session/{session.Id}/download/{Uri.EscapeDataString(name)}" },
                }, UiJsonContext.Default.UiFileDone);
            }
            await Send(new UiDone
            {
                Salt = result.Salt,
                SaltWasGenerated = result.SaltWasGenerated,
                Mapping = result.Mapping.ToJson(),
                Clean = result.Report.Clean,
            }, UiJsonContext.Default.UiDone);
        }
        catch (Exception e) when (e is IOException or InvalidDataException or InvalidOperationException or NotSupportedException
                                      or JsonException or ArgumentException or UnauthorizedAccessException)
        {
            await Send(new UiError { Message = e.Message }, UiJsonContext.Default.UiError);
        }
    }

    private static string SafeName(string raw)
    {
        var name = Path.GetFileName(raw.Replace('\\', '/'));
        foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        if (name.Length == 0 || name is "." or "..") throw new ArgumentException("bad file name");
        return name;
    }

    private static async Task Text(HttpListenerResponse res, int status, string text)
    {
        res.StatusCode = status;
        res.ContentType = "text/plain; charset=utf-8";
        var b = Encoding.UTF8.GetBytes(text);
        res.ContentLength64 = b.Length;
        await res.OutputStream.WriteAsync(b);
    }

    private static async Task Json<T>(HttpListenerResponse res, T value, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> info)
    {
        var b = JsonSerializer.SerializeToUtf8Bytes(value, info);
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = b.Length;
        await res.OutputStream.WriteAsync(b);
    }

    private static void DeleteQuietly(string dir)
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>Open the default browser; failure is fine (the URL is printed).</summary>
    public static void OpenBrowser(string url)
    {
        try
        {
            if (OperatingSystem.IsWindows()) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            else if (OperatingSystem.IsMacOS()) Process.Start("open", url);
            else Process.Start("xdg-open", url);
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or FileNotFoundException) { }
    }

    public void Dispose()
    {
        try { _listener.Close(); } catch (ObjectDisposedException) { }
        DeleteQuietly(_tempRoot);
    }
}

// ── API messages: the same shapes as the browser edition's worker messages ────

internal sealed class UiInfo
{
    public string Edition { get; set; } = "dotnet";
    public string Version { get; set; } = "";
    public string OutputDir { get; set; } = "";
}

internal sealed class UiId
{
    public string? Id { get; set; }
    public string? Name { get; set; }
}

internal sealed class UiDetectRequest
{
    public List<string?> Names { get; set; } = [];
}

internal sealed class UiOverrides
{
    public bool RenumberBuses { get; set; }
    public bool KeepComments { get; set; }
    public bool KeepTitles { get; set; }
    public bool KeepTypeHints { get; set; }
    public List<string> RedactTerms { get; set; } = [];
}

internal sealed class UiRunRequest
{
    public string Mode { get; set; } = "anonymize";
    public List<string?> Names { get; set; } = [];
    public List<string?> Formats { get; set; } = [];
    public string ProfileJson { get; set; } = "";
    public UiOverrides Overrides { get; set; } = new();
    public string? Salt { get; set; }
    public string? MappingJson { get; set; }
}

internal sealed class UiProgress
{
    public string Type { get; set; } = "progress";
    public string Stage { get; set; } = "";
    public string File { get; set; } = "";
    public int Index { get; set; }
    public int Total { get; set; }
}

internal sealed class UiProducedFile
{
    public string Name { get; set; } = "";
    public string Url { get; set; } = "";
}

internal sealed class UiFileDone
{
    public string Type { get; set; } = "file-done";
    public FileReport Report { get; set; } = new();
    public UiProducedFile File { get; set; } = new();
}

internal sealed class UiDone
{
    public string Type { get; set; } = "done";
    public string Salt { get; set; } = "";
    public bool SaltWasGenerated { get; set; }
    public string Mapping { get; set; } = "";
    public bool Clean { get; set; }
    public bool SavedToFolder { get; set; } = true;
}

internal sealed class UiError
{
    public string Type { get; set; } = "error";
    public string Message { get; set; } = "";
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(UiInfo))]
[JsonSerializable(typeof(UiId))]
[JsonSerializable(typeof(UiDetectRequest))]
[JsonSerializable(typeof(UiRunRequest))]
[JsonSerializable(typeof(UiProgress))]
[JsonSerializable(typeof(UiFileDone))]
[JsonSerializable(typeof(UiDone))]
[JsonSerializable(typeof(UiError))]
[JsonSerializable(typeof(List<string>))]
internal sealed partial class UiJsonContext : JsonSerializerContext;
