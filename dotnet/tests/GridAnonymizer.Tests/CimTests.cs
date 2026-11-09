using GridAnonymizer.Hashing;
using GridAnonymizer.IO;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Tests;

public class CimCompatibilityTests
{
    [Theory]
    [InlineData("cim/sample-network.xml", "sample-network.v1-golden.xml")]
    [InlineData("cim/cgmes_eq_uuid.xml", "cgmes_eq_uuid.v1-golden.xml")]
    public void Output_is_byte_identical_to_the_v1_typescript_engine(string sample, string golden)
    {
        using var tmp = new TempDir();
        var input = Run.Sample(sample);
        Run.Anonymize(tmp.Path, files: input);
        Assert.Equal(File.ReadAllText(Run.Data(golden)), File.ReadAllText(Run.Out(tmp.Path, input)));
    }

    [Fact]
    public void Tiny_chunks_produce_the_same_output_as_one_chunk()
    {
        // v1 cut chunks before any '<', which could separate <name>VALUE from its
        // closing tag and let VALUE through. The .NET chunker must not.
        using var big = new TempDir();
        using var tiny = new TempDir();
        var input = Run.Sample("cim/cgmes_eq_uuid.xml");
        Run.Anonymize(big.Path, files: input);
        try
        {
            XmlChunker.ChunkSizeOverride = 37;
            var r = Run.Anonymize(tiny.Path, files: input);
            Assert.True(r.Report.Clean);
        }
        finally { XmlChunker.ChunkSizeOverride = null; }
        Assert.Equal(File.ReadAllText(Run.Out(big.Path, input)), File.ReadAllText(Run.Out(tiny.Path, input)));
    }

    [Fact]
    public void Audit_is_clean_and_names_are_gone()
    {
        using var tmp = new TempDir();
        var input = Run.Sample("cim/sample-network.xml");
        var r = Run.Anonymize(tmp.Path, files: input);
        var audit = r.Report.Files[0].Audit!;
        Assert.True(audit.Clean);
        Assert.True(audit.Hunted > 10);
        var text = File.ReadAllText(Run.Out(tmp.Path, input));
        Assert.DoesNotContain("NORTHWIND", text, StringComparison.Ordinal);
        Assert.DoesNotContain("RIVERBEND", text, StringComparison.Ordinal);
        Assert.DoesNotContain("<!--", text, StringComparison.Ordinal);
        Assert.Contains(">345<", text, StringComparison.Ordinal); // kV kept
    }

    [Fact]
    public void Multi_profile_set_joins_even_when_SSH_is_listed_before_EQ()
    {
        using var tmp = new TempDir();
        var eq = tmp.File("EQ.xml");
        var ssh = tmp.File("SSH.xml");
        File.WriteAllText(eq, """
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#">
            <cim:Substation rdf:ID="_s1"><cim:IdentifiedObject.name>CEDAR HILL</cim:IdentifiedObject.name></cim:Substation>
            <cim:SynchronousMachine rdf:ID="_g1"><cim:IdentifiedObject.name>CEDAR HILL G1</cim:IdentifiedObject.name></cim:SynchronousMachine>
            </rdf:RDF>
            """);
        File.WriteAllText(ssh, """
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#">
            <cim:SynchronousMachine rdf:about="#_g1"><cim:RotatingMachine.p>120</cim:RotatingMachine.p></cim:SynchronousMachine>
            </rdf:RDF>
            """);
        var outDir = tmp.File("out");
        var r = Run.Anonymize(outDir, files: [ssh, eq]);
        Assert.True(r.Report.Clean);
        var eqOut = File.ReadAllText(Run.Out(outDir, eq));
        var sshOut = File.ReadAllText(Run.Out(outDir, ssh));
        Assert.DoesNotContain("CEDAR", eqOut, StringComparison.Ordinal);
        var newId = r.Mapping.Cim.Ids["_g1"];
        Assert.Contains($"rdf:ID=\"{newId}\"", eqOut, StringComparison.Ordinal);
        Assert.Contains($"rdf:about=\"#{newId}\"", sshOut, StringComparison.Ordinal);
        Assert.Equal("SUB_0001_G0001", r.Mapping.Cim.Names["CEDAR HILL G1"]);
    }

    [Fact]
    public void Coordinates_and_redact_terms_are_removed()
    {
        using var tmp = new TempDir();
        var gl = tmp.File("GL.xml");
        File.WriteAllText(gl, """
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#">
            <cim:PositionPoint rdf:ID="_p1"><cim:PositionPoint.xPosition>-121.9857</cim:PositionPoint.xPosition><cim:PositionPoint.yPosition>47.7423</cim:PositionPoint.yPosition></cim:PositionPoint>
            <cim:Analog rdf:ID="_a1"><cim:Measurement.measurementType>ThisIsAcmeEnergy</cim:Measurement.measurementType></cim:Analog>
            </rdf:RDF>
            """);
        var profile = new AnonymizationProfile { RedactTerms = ["Acme Energy", "acmeenergy"] };
        var r = Run.Anonymize(tmp.File("out"), profile, files: gl);
        var text = File.ReadAllText(Run.Out(tmp.File("out"), gl));
        Assert.DoesNotContain("121.98", text, StringComparison.Ordinal);
        Assert.DoesNotContain("Acme", text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ThisIsREDACTED", text, StringComparison.Ordinal);
        Assert.True(r.Report.Clean);
    }

    [Fact]
    public void Restore_reverses_ids_and_names()
    {
        using var tmp = new TempDir();
        var input = Run.Sample("cim/sample-network.xml");
        var profile = new AnonymizationProfile();
        profile.Cim.StripComments = false;
        var r = Run.Anonymize(tmp.Path, profile, files: input);
        var back = Run.Restore(tmp.File("back"), r.Mapping, Run.Out(tmp.Path, input));
        Assert.Equal(File.ReadAllText(input), File.ReadAllText(back.Report.Files[0].Output!));
    }

    [Fact]
    public void Use_mapping_keeps_pseudonyms_stable_across_revisions()
    {
        using var tmp = new TempDir();
        var input = Run.Sample("cim/sample-network.xml");
        var first = Run.Anonymize(tmp.File("a"), salt: null, files: input);
        var second = Run.Anonymize(tmp.File("b"), salt: null, mapping: first.Mapping, files: input);
        Assert.Equal(first.Salt, second.Salt);
        Assert.Equal(File.ReadAllText(Run.Out(tmp.File("a"), input)), File.ReadAllText(Run.Out(tmp.File("b"), input)));
    }

    [Theory]
    [InlineData("_1234", @"^_\d{10}$")]
    [InlineData("_1234_5", @"^_\d{10}_5$")]
    [InlineData("_5f1c2b7a-1d2e-4f3a-8b9c-0d1e2f3a4b5c", "^_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]
    [InlineData("urn:uuid:5f1c2b7a-1d2e-4f3a-8b9c-0d1e2f3a4b5c", "^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4")]
    [InlineData("SUBSTATION-A", "^_[0-9a-f]{24}$")]
    public void Ids_keep_their_shape(string original, string pattern)
    {
        Assert.Matches(pattern, Pseudonym.NewIdFor("salt", original));
        Assert.Equal(Pseudonym.NewIdFor("salt", original), Pseudonym.NewIdFor("salt", original));
        Assert.NotEqual(Pseudonym.NewIdFor("salt", original), Pseudonym.NewIdFor("other", original));
    }
}

public class CgmesBoundaryTests
{
    [Fact]
    public void External_references_can_be_kept_for_boundary_set_merging()
    {
        using var tmp = new TempDir();
        var input = Run.Sample("cim/cgmes_eq_uuid.xml");
        var p = new AnonymizationProfile();
        p.Cim.AnonymizeExternalReferences = false;
        var r = Run.Anonymize(tmp.Path, p, files: input);
        var text = File.ReadAllText(Run.Out(tmp.Path, input));
        Assert.Contains("urn:uuid:0a1b2c3d-1111-4222-8333-444455556666", text, StringComparison.Ordinal);
        Assert.DoesNotContain("HARBOR", text, StringComparison.Ordinal);
        Assert.True(r.Report.Clean);
    }

    [Fact]
    public void Preserved_id_patterns_are_left_alone()
    {
        using var tmp = new TempDir();
        var input = Run.Sample("cim/sample-network.xml");
        var p = new AnonymizationProfile();
        p.Cim.PreserveIdPatterns = ["^_10\\d\\d$"];
        var r = Run.Anonymize(tmp.Path, p, files: input);
        var text = File.ReadAllText(Run.Out(tmp.Path, input));
        Assert.Contains("rdf:ID=\"_1010\"", text, StringComparison.Ordinal);
        Assert.DoesNotContain("rdf:ID=\"_2000\"", text, StringComparison.Ordinal);
        Assert.True(r.Report.Clean);
    }
}

public class CimRobustnessTests
{
    private const string Head = "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:cim=\"http://iec.ch/TC57/CIM100#\">\n";

    [Fact]
    public void Attributes_on_name_elements_and_non_first_rdf_ID_are_handled()
    {
        using var tmp = new TempDir();
        var f = tmp.File("a.xml");
        File.WriteAllText(f, Head +
            "<cim:Substation xmlns:x=\"urn:x\" rdf:ID=\"_s9\"><cim:IdentifiedObject.name xml:lang=\"en\">PINE\nRIDGE</cim:IdentifiedObject.name></cim:Substation>\n</rdf:RDF>\n");
        var r = Run.Anonymize(tmp.File("o"), files: f);
        var text = File.ReadAllText(Run.Out(tmp.File("o"), f));
        Assert.DoesNotContain("PINE", text, StringComparison.Ordinal);
        Assert.DoesNotContain("_s9", text, StringComparison.Ordinal);
        Assert.Contains("xml:lang=\"en\">SUB_0001<", text, StringComparison.Ordinal);
        Assert.True(r.Report.Clean);
    }

    [Theory]
    [InlineData("<cim:Substation rdf:ID='_s1'><cim:IdentifiedObject.name>PINE</cim:IdentifiedObject.name></cim:Substation>")]
    [InlineData("<cim:Substation rdf:ID=\"_s1\"><cim:IdentifiedObject.name><![CDATA[PINE]]></cim:IdentifiedObject.name></cim:Substation>")]
    public void Constructs_it_cannot_see_into_are_refused_not_half_done(string body)
    {
        using var tmp = new TempDir();
        var f = tmp.File("a.xml");
        File.WriteAllText(f, Head + body + "\n</rdf:RDF>\n");
        Assert.Throws<NotSupportedException>(() => Run.Anonymize(tmp.File("o"), files: f));
        Assert.False(File.Exists(Run.Out(tmp.File("o"), f)));
    }
}
