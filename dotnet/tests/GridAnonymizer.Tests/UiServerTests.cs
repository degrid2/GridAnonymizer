using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GridAnonymizer.Cli.Ui;

namespace GridAnonymizer.Tests;

public sealed class UiServerTests : IDisposable
{
    private readonly TempDir _tmp = new();
    private readonly UiServer _server;
    private readonly CancellationTokenSource _cts = new();
    private readonly HttpClient _http;
    private readonly string _token;

    public UiServerTests()
    {
        _server = new UiServer(_tmp.File("out"));
        _ = _server.RunAsync(_cts.Token);
        _token = _server.Url[(_server.Url.IndexOf("?t=", StringComparison.Ordinal) + 3)..];
        _http = new HttpClient { BaseAddress = new Uri($"http://localhost:{_server.Port}/") };
    }

    private HttpRequestMessage Api(HttpMethod method, string path, HttpContent? body = null, bool token = true)
    {
        var r = new HttpRequestMessage(method, path) { Content = body };
        if (token) r.Headers.Add("X-GridAnon-Token", _token);
        return r;
    }

    [Fact]
    public async Task Serves_the_embedded_page_with_a_loopback_only_csp()
    {
        var res = await _http.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("GridAnonymizer", await res.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Contains("connect-src 'self'", res.Headers.GetValues("Content-Security-Policy").Single(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Api_refuses_missing_token_foreign_origin_and_foreign_host()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _http.SendAsync(Api(HttpMethod.Get, "/api/info", token: false))).StatusCode);

        var cross = Api(HttpMethod.Get, "/api/info");
        cross.Headers.Add("Origin", "https://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await _http.SendAsync(cross)).StatusCode);

        var rebinding = Api(HttpMethod.Get, "/api/info");
        rebinding.Headers.Host = $"evil.example:{_server.Port}";
        var status = (await _http.SendAsync(rebinding)).StatusCode;
        Assert.True(status is HttpStatusCode.MisdirectedRequest or HttpStatusCode.BadRequest or HttpStatusCode.NotFound, status.ToString());

        Assert.Equal(HttpStatusCode.OK, (await _http.SendAsync(Api(HttpMethod.Get, "/api/info"))).StatusCode);
    }

    [Fact]
    public async Task Upload_detect_run_download_matches_the_engine()
    {
        var session = (await (await _http.SendAsync(Api(HttpMethod.Post, "/api/session"))).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var files = new[] { "psse/meridian_v33.raw", "psse/study_results.csv" };
        var names = new List<string>();
        foreach (var f in files)
        {
            var put = await _http.SendAsync(Api(HttpMethod.Put, $"/api/session/{session}/file?name={Path.GetFileName(f)}", new ByteArrayContent(File.ReadAllBytes(Run.Sample(f)))));
            names.Add((await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString()!);
        }
        var detect = await _http.SendAsync(Api(HttpMethod.Post, $"/api/session/{session}/detect",
            new StringContent(JsonSerializer.Serialize(new { names }), Encoding.UTF8, "application/json")));
        Assert.Equal(["psse", "text"], (await detect.Content.ReadFromJsonAsync<string[]>())!);

        var run = new
        {
            mode = "anonymize",
            names,
            formats = new[] { "psse", "text" },
            profileJson = "",
            salt = "test-salt-123",
            overrides = new { renumberBuses = true, keepComments = false, keepTitles = false, keepTypeHints = false, redactTerms = Array.Empty<string>() }
        };
        var res = await _http.SendAsync(Api(HttpMethod.Post, $"/api/session/{session}/run",
            new StringContent(JsonSerializer.Serialize(run), Encoding.UTF8, "application/json")));
        var messages = (await res.Content.ReadAsStringAsync()).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => JsonDocument.Parse(l).RootElement).ToList();
        Assert.Contains(messages, m => m.GetProperty("type").GetString() == "progress");
        var done = messages.Single(m => m.GetProperty("type").GetString() == "done");
        Assert.True(done.GetProperty("clean").GetBoolean());

        // The same run through the engine directly.
        var profile = new Profiles.AnonymizationProfile();
        profile.Psse.RenumberBuses = true;
        var expected = Run.Anonymize(_tmp.File("direct"), profile, files: [.. files.Select(Run.Sample)]);

        foreach (var fileDone in messages.Where(m => m.GetProperty("type").GetString() == "file-done"))
        {
            var url = fileDone.GetProperty("file").GetProperty("url").GetString()!;
            var name = fileDone.GetProperty("file").GetProperty("name").GetString()!;
            Assert.Equal(HttpStatusCode.Unauthorized, (await _http.GetAsync(url)).StatusCode);
            var bytes = await _http.GetByteArrayAsync(url + "?t=" + _token);
            Assert.Equal(File.ReadAllBytes(Path.Combine(_tmp.File("direct"), name)), bytes);
        }
        Assert.Equal(2, expected.Report.Files.Count);
    }

    [Fact]
    public async Task A_psse_set_keeps_its_layout_and_comes_back_as_one_zip()
    {
        var session = (await (await _http.SendAsync(Api(HttpMethod.Post, "/api/session"))).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var paths = new[] { "case/meridian_v33.raw", "study/meridian_v33.con", "study/meridian_v33.mon" };
        var names = new List<string>();
        foreach (var p in paths)
        {
            var put = await _http.SendAsync(Api(HttpMethod.Put, $"/api/session/{session}/file?name={Path.GetFileName(p)}", new ByteArrayContent(File.ReadAllBytes(Run.Sample("psse/" + Path.GetFileName(p))))));
            names.Add((await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString()!);
        }
        var run = new
        {
            mode = "anonymize",
            names,
            paths,
            zipName = "meridian_anonymized.zip",
            formats = new string?[] { null, null, null },
            profileJson = "",
            salt = "test-salt-123",
            overrides = new { renumberBuses = true, keepComments = false, keepTitles = false, keepTypeHints = false, redactTerms = Array.Empty<string>() }
        };
        var res = await _http.SendAsync(Api(HttpMethod.Post, $"/api/session/{session}/run",
            new StringContent(JsonSerializer.Serialize(run), Encoding.UTF8, "application/json")));
        var messages = (await res.Content.ReadAsStringAsync()).Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => JsonDocument.Parse(l).RootElement).ToList();
        var done = messages.Single(m => m.GetProperty("type").GetString() == "done");
        Assert.True(done.GetProperty("clean").GetBoolean(), string.Join("\n", messages));
        Assert.True(File.Exists(Path.Combine(_tmp.File("out"), "study", "meridian_v33_anonymized.con")));

        var zip = done.GetProperty("zip");
        Assert.Equal("meridian_anonymized.zip", zip.GetProperty("name").GetString());
        var bytes = await _http.GetByteArrayAsync(zip.GetProperty("url").GetString() + "?t=" + _token);
        using var archive = new ZipArchive(new MemoryStream(bytes));
        Assert.Equal(paths.Order(), archive.Entries.Select(e => e.FullName).Order());
        using var con = new StreamReader(archive.GetEntry("study/meridian_v33.con")!.Open());
        Assert.DoesNotContain("NW-RB", await con.ReadToEndAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Paths_cannot_escape_the_output_folder()
    {
        var session = (await (await _http.SendAsync(Api(HttpMethod.Post, "/api/session"))).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var put = await _http.SendAsync(Api(HttpMethod.Put, $"/api/session/{session}/file?name=x.con", new StringContent("CONTINGENCY 'A'\nEND\nEND\n")));
        var name = (await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString();
        var run = new
        {
            mode = "anonymize",
            names = new[] { name },
            paths = new[] { "../../evil/x.con" },
            formats = new string?[] { null },
            profileJson = "",
            overrides = new { renumberBuses = false, keepComments = false, keepTitles = false, keepTypeHints = false, redactTerms = Array.Empty<string>() }
        };
        var res = await _http.SendAsync(Api(HttpMethod.Post, $"/api/session/{session}/run", new StringContent(JsonSerializer.Serialize(run), Encoding.UTF8, "application/json")));
        Assert.Contains("\"type\":\"error\"", await res.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(_tmp.Path, "evil")));
    }

    public void Dispose()
    {
        _cts.Cancel();
        _server.Dispose();
        _http.Dispose();
        _cts.Dispose();
        _tmp.Dispose();
    }
}
