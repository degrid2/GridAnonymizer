using System.IO.Compression;
using GridAnonymizer.IO;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Tests;

public class PsseAuxTests
{
    private static readonly string Raw = Run.Sample("psse/meridian_v33.raw");
    private static readonly string Con = Run.Sample("psse/meridian_v33.con");
    private static readonly string Mon = Run.Sample("psse/meridian_v33.mon");
    private static readonly string Sub = Run.Sample("psse/meridian_v33.sub");

    private static AnonymizationProfile Renumbering()
    {
        var p = new AnonymizationProfile();
        p.Psse.RenumberBuses = true;
        return p;
    }

    [Fact]
    public void Companion_files_follow_the_renumbered_case()
    {
        using var tmp = new TempDir();
        var r = Run.Anonymize(tmp.Path, Renumbering(), files: [Raw, Con, Mon, Sub]);
        Assert.True(r.Report.Clean, string.Join(";", r.Report.Files.SelectMany(f => f.Audit!.IntegrityIssues.Concat(f.Audit.LeakedNames))));
        var b = r.Mapping.Psse.Buses;
        var con = File.ReadAllText(Run.Out(tmp.Path, Con));
        Assert.Contains($"OPEN BRANCH FROM BUS {b["101"],3} TO BUS {b["201"],3} CIRCUIT 1", con, StringComparison.Ordinal);
        Assert.Contains($"REMOVE MACHINE 1 FROM BUS {b["302"],3}", con, StringComparison.Ordinal);
        foreach (var w in new[] { "NORTHWIND", "Meridian", "STONEGATE", "NW-RB" })
            Assert.DoesNotContain(w, con, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("COM ", con, StringComparison.Ordinal);
    }

    [Fact]
    public void Bus_ranges_are_expanded_into_the_new_numbers()
    {
        using var tmp = new TempDir();
        var r = Run.Anonymize(tmp.Path, Renumbering(), files: [Raw, Sub]);
        var b = r.Mapping.Psse.Buses;
        var expected = new[] { "101", "102", "201", "202" }.Select(k => b[k]).Order().Select(n => $"  BUS {n}");
        var lines = File.ReadAllLines(Run.Out(tmp.Path, Sub));
        Assert.Equal(expected, lines.Skip(1).Take(4));
        Assert.DoesNotContain(lines, l => l.Contains("BUSES", StringComparison.Ordinal));
    }

    [Fact]
    public void Labels_are_consistent_across_files_and_reach_results_csvs()
    {
        using var tmp = new TempDir();
        var csv = Run.Sample("psse/study_results.csv");
        var r = Run.Anonymize(tmp.Path, files: [Raw, Con, Mon, Sub, csv]);
        Assert.True(r.Report.Clean);
        var label = r.Mapping.Psse.Names["NORTHWIND AREA"];
        Assert.StartsWith("SUBSYS_", label, StringComparison.Ordinal);
        Assert.Contains(label, File.ReadAllText(Run.Out(tmp.Path, Mon)), StringComparison.Ordinal);
        Assert.Contains(label, File.ReadAllText(Run.Out(tmp.Path, Sub)), StringComparison.Ordinal);
        Assert.Contains($"\"{r.Mapping.Psse.Names["NW-RB 345 L1 OUT"]}\"", File.ReadAllText(Run.Out(tmp.Path, csv)), StringComparison.Ordinal);
    }

    [Fact]
    public void Companion_files_restore_with_the_mapping()
    {
        using var tmp = new TempDir();
        var p = Renumbering();
        p.Psse.StripComments = false;
        var r = Run.Anonymize(tmp.Path, p, files: [Raw, Con, Mon]);
        var back = Run.Restore(tmp.File("back"), r.Mapping, Run.Out(tmp.Path, Con), Run.Out(tmp.Path, Mon));
        string Norm(string s) => string.Join("\n", s.Split('\n').Select(l => System.Text.RegularExpressions.Regex.Replace(l, @"\s+", " ").Replace("' ", "'", StringComparison.Ordinal).Replace(" '", "'", StringComparison.Ordinal).Trim()));
        Assert.Equal(Norm(File.ReadAllText(Con)), Norm(File.ReadAllText(back.Report.Files.Single(f => f.Input.EndsWith(".con", StringComparison.Ordinal)).Output!)));
        Assert.Equal(Norm(File.ReadAllText(Mon)), Norm(File.ReadAllText(back.Report.Files.Single(f => f.Input.EndsWith(".mon", StringComparison.Ordinal)).Output!)));
    }

    [Fact]
    public void A_bus_missing_from_the_case_is_flagged()
    {
        using var tmp = new TempDir();
        var con = tmp.File("extra.con");
        File.WriteAllText(con, "CONTINGENCY 'X1'\n  OPEN BRANCH FROM BUS 101 TO BUS 999 CIRCUIT 1\nEND\nEND\n");
        var r = Run.Anonymize(tmp.File("o"), Renumbering(), files: [Raw, con]);
        var f = r.Report.Files.Single(x => x.Format == "psse-aux");
        Assert.Contains(f.Warnings, w => w.Contains("999", StringComparison.Ordinal));
        Assert.True(f.Audit!.Clean); // already dangling in the original: not a new problem
    }

    [Fact]
    public void Warns_when_renumbering_without_the_case()
    {
        using var tmp = new TempDir();
        var r = Run.Anonymize(tmp.Path, Renumbering(), files: [Con]);
        Assert.Contains(r.Report.Files[0].Warnings, w => w.Contains(".raw", StringComparison.Ordinal));
    }
}

public class ZipBundleTests
{
    [Theory]
    [InlineData("a/b.raw", "a/b.raw")]
    [InlineData("a\\b.con", "a/b.con")]
    [InlineData("./x.raw", "x.raw")]
    [InlineData("dir/", null)]
    [InlineData("__MACOSX/._x.raw", null)]
    [InlineData("a/.DS_Store", null)]
    public void Entry_names_are_normalized(string name, string? expected) => Assert.Equal(expected, ZipBundle.SafeRelativePath(name));

    [Theory]
    [InlineData("../evil.raw")]
    [InlineData("a/../../evil.raw")]
    [InlineData("/etc/passwd")]
    [InlineData("C:/Windows/x")]
    public void Zip_slip_is_refused(string name) => Assert.Throws<InvalidDataException>(() => ZipBundle.SafeRelativePath(name));

    [Fact]
    public void Extract_and_write_round_trip()
    {
        using var tmp = new TempDir();
        var zip = tmp.File("case.zip");
        using (var z = ZipFile.Open(zip, ZipArchiveMode.Create))
        {
            z.CreateEntryFromFile(Run.Sample("psse/meridian_v33.raw"), "case/meridian_v33.raw");
            z.CreateEntryFromFile(Run.Sample("psse/meridian_v33.con"), "case/studies/meridian_v33.con");
        }
        var entries = ZipBundle.Extract(zip, tmp.File("x"));
        Assert.Equal(["case/meridian_v33.raw", "case/studies/meridian_v33.con"], entries.Select(e => e.RelativePath));
        ZipBundle.Write(tmp.File("out.zip"), entries.Select(e => (e.RelativePath, e.FullPath)));
        using var back = ZipFile.OpenRead(tmp.File("out.zip"));
        Assert.Equal(2, back.Entries.Count);
    }
}
