using GridAnonymizer.Formats.Psse;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Tests;

public class PsseTests
{
    private static readonly string V33 = Run.Sample("psse/meridian_v33.raw");
    private static readonly string V35 = Run.Sample("psse/meridian_v35.raw");

    private static AnonymizationProfile Renumbering()
    {
        var p = new AnonymizationProfile();
        p.Psse.RenumberBuses = true;
        return p;
    }

    [Theory]
    [InlineData("psse/meridian_v33.raw")]
    [InlineData("psse/meridian_v35.raw")]
    public void Names_titles_and_comments_are_removed(string sample)
    {
        using var tmp = new TempDir();
        var input = Run.Sample(sample);
        var r = Run.Anonymize(tmp.Path, files: input);
        var text = File.ReadAllText(Run.Out(tmp.Path, input));
        Assert.True(r.Report.Clean, string.Join(";", r.Report.Files[0].Audit!.LeakedNames));
        foreach (var word in new[] { "NORTHWIND", "RIVERBEND", "MERIDIAN", "Meridian", "CONFIDENTIAL", "rawd3" })
            Assert.DoesNotContain(word, text, StringComparison.Ordinal);
        Assert.Contains("END OF BUS DATA, BEGIN LOAD DATA", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Electrical_data_and_short_ids_are_untouched()
    {
        using var tmp = new TempDir();
        Run.Anonymize(tmp.Path, files: V33);
        var orig = File.ReadAllLines(V33);
        var anon = File.ReadAllLines(Run.Out(tmp.Path, V33));
        Assert.Equal(orig.Length, anon.Length);
        Assert.Contains("'YNd1        '", anon[24], StringComparison.Ordinal);
        Assert.Contains(" 2.50000E-3, 2.80000E-2,   0.45000", anon[20], StringComparison.Ordinal);
        Assert.StartsWith("   101,'BUS_0001    ', 345.0000", anon[3], StringComparison.Ordinal);
    }

    [Fact]
    public void Renumbering_is_consistent_everywhere_a_bus_is_referenced()
    {
        using var tmp = new TempDir();
        var r = Run.Anonymize(tmp.Path, Renumbering(), files: V33);
        var f = r.Report.Files[0];
        Assert.True(f.Audit!.Clean, string.Join(";", f.Audit.IntegrityIssues));
        var map = r.Mapping.Psse.Buses;
        Assert.Equal(7, map.Count);
        Assert.Equal(31, f.Stats["busNumbers"]);
        var anon = File.ReadAllLines(Run.Out(tmp.Path, V33));
        // generator at 302 regulates 301 (IREG), 3-winding transformer CONT1 = -303
        Assert.Contains($",{map["301"],6},", anon[18], StringComparison.Ordinal);
        Assert.Contains($", {("-" + map["303"]),5},", anon[30], StringComparison.Ordinal);
    }

    [Fact]
    public void Shuffled_and_sequential_strategies_differ_but_both_are_bijective()
    {
        using var tmp = new TempDir();
        var seq = Renumbering();
        seq.Psse.BusNumberStrategy = "sequential";
        var a = Run.Anonymize(tmp.File("a"), seq, files: V33).Mapping.Psse.Buses;
        var b = Run.Anonymize(tmp.File("b"), Renumbering(), files: V33).Mapping.Psse.Buses;
        Assert.Equal([1, 2, 3, 4, 5, 6, 7], a.Values.Order());
        Assert.Equal([1, 2, 3, 4, 5, 6, 7], b.Values.Order());
        Assert.Equal(1, a["101"]);
        Assert.NotEqual(a.OrderBy(k => k.Key).Select(k => k.Value), b.OrderBy(k => k.Key).Select(k => k.Value));
    }

    [Fact]
    public void V35_substation_coordinates_are_zeroed_and_node_buses_renumbered()
    {
        using var tmp = new TempDir();
        var r = Run.Anonymize(tmp.Path, Renumbering(), files: V35);
        Assert.True(r.Report.Clean);
        var text = File.ReadAllText(Run.Out(tmp.Path, V35));
        Assert.DoesNotContain("47.7423", text, StringComparison.Ordinal);
        Assert.DoesNotContain("121.9857", text, StringComparison.Ordinal);
        Assert.Contains("'NODE_0001   ',     " + r.Mapping.Psse.Buses["101"] + ",", text, StringComparison.Ordinal);
        Assert.Contains("RATING, 1, \"RATE1 \"", text, StringComparison.Ordinal); // system-wide data kept
    }

    [Fact]
    public void Two_cases_of_one_system_share_names_and_numbers()
    {
        using var tmp = new TempDir();
        var r = Run.Anonymize(tmp.Path, Renumbering(), files: [V33, V35]);
        Assert.True(r.Report.Clean);
        var a = File.ReadAllLines(Run.Out(tmp.Path, V33));
        var b = File.ReadAllLines(Run.Out(tmp.Path, V35));
        Assert.Equal(a[3][..22], b[8][..22]); // bus 101 'NORTHWIND' identical in both outputs
    }

    [Fact]
    public void Restore_round_trips_names_and_bus_numbers()
    {
        using var tmp = new TempDir();
        var p = Renumbering();
        p.Psse.StripComments = false;
        p.Psse.ReplaceCaseTitle = false;
        var r = Run.Anonymize(tmp.Path, p, files: V33);
        var back = Run.Restore(tmp.File("back"), r.Mapping, Run.Out(tmp.Path, V33));
        Assert.Equal(Normalize(V33), Normalize(back.Report.Files[0].Output!));
    }

    private static List<string> Normalize(string path) =>
        [.. File.ReadAllLines(path).Select(l => string.Join("|", PsseRaw.Tokenize(l, out _).Select(t => t.Inner(l).Trim())))];

    [Fact]
    public void Renumbering_refuses_sections_it_cannot_map_safely()
    {
        using var tmp = new TempDir();
        var raw = tmp.File("gne.raw");
        var lines = File.ReadAllLines(V33).ToList();
        var gne = lines.FindIndex(l => l.Contains("BEGIN GNE DEVICE DATA", StringComparison.Ordinal));
        lines.Insert(gne + 1, "'MYGNE','GNEMODEL',2,101,201,0,0,0,1,1,0");
        File.WriteAllLines(raw, lines);
        var ex = Assert.Throws<NotSupportedException>(() => Run.Anonymize(tmp.File("o"), Renumbering(), files: raw));
        Assert.Contains("GNE", ex.Message, StringComparison.Ordinal);
        // names-only still works
        Assert.True(Run.Anonymize(tmp.File("o2"), files: raw).Report.Clean);
    }

    [Fact]
    public void Companion_csv_uses_the_same_pseudonyms_and_restores()
    {
        using var tmp = new TempDir();
        var csv = Run.Sample("psse/study_results.csv");
        var r = Run.Anonymize(tmp.Path, files: [V33, V35, csv]);
        Assert.True(r.Report.Clean);
        var anon = File.ReadAllText(Run.Out(tmp.Path, csv));
        Assert.DoesNotContain("NORTHWIND", anon, StringComparison.Ordinal);
        Assert.Contains(r.Mapping.Psse.Names["NW-RB 345 L1"], anon, StringComparison.Ordinal);
        var back = Run.Restore(tmp.File("back"), r.Mapping, Run.Out(tmp.Path, csv));
        Assert.Equal(File.ReadAllText(csv), File.ReadAllText(back.Report.Files[0].Output!));
    }

    [Fact]
    public void Preserve_patterns_keep_matching_names()
    {
        using var tmp = new TempDir();
        var p = new AnonymizationProfile { PreserveNames = ["^STONEGATE Z$"] };
        var r = Run.Anonymize(tmp.Path, p, files: V33);
        Assert.Equal("STONEGATE Z", r.Mapping.Psse.Names["STONEGATE Z"]);
        Assert.Contains("'STONEGATE Z '", File.ReadAllText(Run.Out(tmp.Path, V33)), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("101,'A B',,3 / c", new[] { "101", "A B", "", "3" }, 13)]
    [InlineData("  1 2  3", new[] { "1", "2", "3" }, -1)]
    [InlineData("1,'x/y', 2", new[] { "1", "x/y", "2" }, -1)]
    [InlineData("1, \"RATE1 \"", new[] { "1", "RATE1 " }, -1)]
    public void Tokenizer_handles_defaults_quotes_and_comments(string line, string[] expected, int comment)
    {
        var tokens = PsseRaw.Tokenize(line, out var cs);
        Assert.Equal(expected, tokens.Select(t => t.Inner(line)));
        Assert.Equal(comment, cs);
    }
}

public class LineEndingTests
{
    [Theory]
    [InlineData("\r\n")]
    [InlineData("\n")]
    public void Raw_and_text_outputs_keep_the_input_line_ending(string nl)
    {
        using var tmp = new TempDir();
        var raw = tmp.File("case.raw");
        File.WriteAllText(raw, string.Join(nl, File.ReadAllLines(Run.Sample("psse/meridian_v33.raw"))) + nl);
        var csv = tmp.File("r.csv");
        File.WriteAllText(csv, "a,NORTHWIND" + nl + "b,RIVERBEND" + nl);
        Run.Anonymize(tmp.File("o"), files: [raw, csv]);
        foreach (var f in new[] { raw, csv })
        {
            var text = File.ReadAllText(Run.Out(tmp.File("o"), f));
            Assert.Equal(nl == "\r\n", text.Contains("\r\n", StringComparison.Ordinal));
            Assert.EndsWith(nl, text, StringComparison.Ordinal);
        }
    }
}
