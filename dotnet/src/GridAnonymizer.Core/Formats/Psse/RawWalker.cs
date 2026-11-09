using System.Globalization;

namespace GridAnonymizer.Formats.Psse;

internal enum PsseSection
{
    CaseId, SystemWide, Bus, Load, FixedShunt, Generator, Branch, SwitchingDevice, Transformer, Area,
    TwoTerminalDc, VscDc, ImpedanceCorrection, MultiTerminalDc, MultiSectionLine, Zone, InterAreaTransfer,
    Owner, Facts, SwitchedShunt, Gne, InductionMachine, Substation, End, Unknown,
}

internal enum LineKind { Passthrough, CaseId, Title, Data, Terminator, End, Trailer }

/// <summary>One field of a RAW record. Empty fields (",,") have Length 0.</summary>
internal readonly record struct RawToken(int Start, int Length, bool Quoted)
{
    public string Text(string line) => line.Substring(Start, Length);

    /// <summary>Contents of a quoted string, without the quotes.</summary>
    public string Inner(string line) => Quoted && Length >= 2 ? line.Substring(Start + 1, Length - 2) : Text(line);

    public bool IsEmpty => Length == 0;
}

internal sealed class RawLine
{
    public required string Text { get; init; }
    public LineKind Kind { get; init; }
    public PsseSection Section { get; init; }

    /// <summary>0-based line within a multi-line record (transformers, DC lines...).</summary>
    public int RecordLine { get; init; }

    /// <summary>Substation data nesting: 0 substation, 1 node, 2 switching device, 3 equipment terminal.</summary>
    public int SubBlock { get; init; }

    public List<RawToken> Tokens { get; init; } = [];
    public int CommentStart { get; init; } = -1;
    public int TitleIndex { get; init; }

    public string Comment => CommentStart < 0 ? "" : Text[(CommentStart + 1)..];

    public string SectionKey => Section switch
    {
        PsseSection.Substation => SubBlock switch
        {
            1 => "substation-node",
            2 => "substation-switching-device",
            3 => "substation-equipment",
            _ => "substation",
        },
        _ => PsseRaw.Key(Section),
    };
}

internal static class PsseRaw
{
    public static string Key(PsseSection s) => s switch
    {
        PsseSection.SystemWide => "system-wide",
        PsseSection.FixedShunt => "fixed-shunt",
        PsseSection.SwitchingDevice => "switching-device",
        PsseSection.TwoTerminalDc => "two-terminal-dc",
        PsseSection.VscDc => "vsc-dc",
        PsseSection.ImpedanceCorrection => "impedance-correction",
        PsseSection.MultiTerminalDc => "multi-terminal-dc",
        PsseSection.MultiSectionLine => "multi-section-line",
        PsseSection.InterAreaTransfer => "inter-area-transfer",
        PsseSection.SwitchedShunt => "switched-shunt",
        PsseSection.InductionMachine => "induction-machine",
        _ => s.ToString().ToLowerInvariant(),
    };

    /// <summary>
    /// Split a RAW line into fields. Fields are separated by a comma (optionally
    /// padded with blanks) or by blanks; two commas in a row are an empty
    /// (defaulted) field; '/' outside quotes starts a comment. Single and double
    /// quotes both delimit strings (v35 uses double quotes in system-wide data).
    /// </summary>
    public static List<RawToken> Tokenize(string line, out int commentStart)
    {
        var tokens = new List<RawToken>();
        commentStart = -1;
        var i = 0;
        var expecting = true;
        var len = line.Length;
        while (i < len)
        {
            var c = line[i];
            if (c is ' ' or '\t') { i++; continue; }
            if (c == '/') { commentStart = i; break; }
            if (c == ',')
            {
                if (expecting) tokens.Add(new RawToken(i, 0, false));
                expecting = true;
                i++;
                continue;
            }
            if (c is '\'' or '"')
            {
                var end = line.IndexOf(c, i + 1);
                if (end < 0) end = len - 1;
                tokens.Add(new RawToken(i, end - i + 1, true));
                i = end + 1;
            }
            else
            {
                var j = i;
                while (j < len && line[j] is not (' ' or '\t' or ',' or '/')) j++;
                tokens.Add(new RawToken(i, j - i, false));
                i = j;
            }
            expecting = false;
            while (i < len && line[i] is ' ' or '\t') i++;
            if (i < len && line[i] == ',') { i++; expecting = true; }
            else expecting = true;
        }
        return tokens;
    }

    public static bool TryInt(string line, RawToken t, out int value)
    {
        value = 0;
        return !t.Quoted && !t.IsEmpty &&
               int.TryParse(line.AsSpan(t.Start, t.Length), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value);
    }

    private static readonly (string Keyword, PsseSection Section)[] Keywords =
    [
        ("SYSTEM-WIDE", PsseSection.SystemWide), ("SYSTEM WIDE", PsseSection.SystemWide),
        ("SYSTEM SWITCHING", PsseSection.SwitchingDevice), ("SUBSTATION", PsseSection.Substation),
        ("IMPEDANCE CORRECTION", PsseSection.ImpedanceCorrection),
        ("MULTI-SECTION", PsseSection.MultiSectionLine), ("MULTI SECTION", PsseSection.MultiSectionLine),
        ("MULTI-TERMINAL", PsseSection.MultiTerminalDc), ("MULTI TERMINAL", PsseSection.MultiTerminalDc),
        ("TWO-TERMINAL", PsseSection.TwoTerminalDc), ("TWO TERMINAL", PsseSection.TwoTerminalDc),
        ("VSC", PsseSection.VscDc), ("VOLTAGE SOURCE", PsseSection.VscDc),
        ("INTER-AREA", PsseSection.InterAreaTransfer), ("INTERAREA", PsseSection.InterAreaTransfer),
        ("BRANCH", PsseSection.Branch), ("TRANSFORMER", PsseSection.Transformer),
        ("FIXED SHUNT", PsseSection.FixedShunt), ("SWITCHED SHUNT", PsseSection.SwitchedShunt),
        ("INDUCTION", PsseSection.InductionMachine), ("GENERATOR", PsseSection.Generator),
        ("MACHINE", PsseSection.Generator), ("LOAD", PsseSection.Load), ("AREA", PsseSection.Area),
        ("ZONE", PsseSection.Zone), ("OWNER", PsseSection.Owner), ("FACTS", PsseSection.Facts),
        ("GNE", PsseSection.Gne), ("BUS", PsseSection.Bus),
    ];

    public static PsseSection? SectionFromLabel(string label)
    {
        var upper = label.ToUpperInvariant();
        var begin = upper.IndexOf("BEGIN", StringComparison.Ordinal);
        if (begin < 0) return null;
        var name = upper[(begin + 5)..];
        foreach (var (k, s) in Keywords)
            if (name.Contains(k, StringComparison.Ordinal)) return s;
        return PsseSection.Unknown;
    }

    private static readonly PsseSection[] OrderV33 =
    [
        PsseSection.Bus, PsseSection.Load, PsseSection.FixedShunt, PsseSection.Generator, PsseSection.Branch,
        PsseSection.Transformer, PsseSection.Area, PsseSection.TwoTerminalDc, PsseSection.VscDc,
        PsseSection.ImpedanceCorrection, PsseSection.MultiTerminalDc, PsseSection.MultiSectionLine, PsseSection.Zone,
        PsseSection.InterAreaTransfer, PsseSection.Owner, PsseSection.Facts, PsseSection.SwitchedShunt,
        PsseSection.Gne, PsseSection.InductionMachine, PsseSection.End,
    ];

    private static readonly PsseSection[] OrderV34 =
    [
        PsseSection.SystemWide, PsseSection.Bus, PsseSection.Load, PsseSection.FixedShunt, PsseSection.Generator,
        PsseSection.Branch, PsseSection.SwitchingDevice, PsseSection.Transformer, PsseSection.Area,
        PsseSection.TwoTerminalDc, PsseSection.VscDc, PsseSection.ImpedanceCorrection, PsseSection.MultiTerminalDc,
        PsseSection.MultiSectionLine, PsseSection.Zone, PsseSection.InterAreaTransfer, PsseSection.Owner,
        PsseSection.Facts, PsseSection.SwitchedShunt, PsseSection.Gne, PsseSection.InductionMachine,
        PsseSection.Substation, PsseSection.End,
    ];

    public static PsseSection NextInOrder(int version, PsseSection current)
    {
        var order = version >= 34 ? OrderV34 : OrderV33;
        var i = Array.IndexOf(order, current);
        return i < 0 || i + 1 >= order.Length ? PsseSection.End : order[i + 1];
    }

    private static readonly HashSet<string> SystemWideKeywords =
        ["GENERAL", "GAUSS", "NEWTON", "ADJUST", "TYSL", "SOLVER", "RATING"];

    public static bool IsSystemWideRecord(string line, List<RawToken> tokens) =>
        tokens.Count > 0 && !tokens[0].Quoted && SystemWideKeywords.Contains(tokens[0].Text(line).ToUpperInvariant());
}

/// <summary>
/// Walks a RAW file line by line and tells each line which section and record
/// position it belongs to. Section boundaries come from the "0 / END OF X DATA,
/// BEGIN Y DATA" labels PSS/E writes; files without labels fall back to the
/// documented section order for their revision.
/// </summary>
internal sealed class RawWalker
{
    public int Version { get; private set; } = 33;
    public bool VersionFromFile { get; private set; }
    public bool SawLabels { get; private set; }
    public bool SawUnlabeledTerminator { get; private set; }

    public IEnumerable<RawLine> Walk(TextReader reader)
    {
        var phase = 0; // 0 case id, 1-2 titles, 3 data, 4 after Q
        var section = PsseSection.Bus;
        var firstData = true;
        var remaining = 0;
        var recordLine = 0;
        var sub = 0;

        string? text;
        while ((text = reader.ReadLine()) is not null)
        {
            if (phase == 4)
            {
                yield return new RawLine { Text = text, Kind = LineKind.Trailer, Section = PsseSection.End };
                continue;
            }
            if (text.StartsWith("@!", StringComparison.Ordinal) || (phase == 3 && text.Trim().Length == 0 && remaining == 0))
            {
                yield return new RawLine { Text = text, Kind = LineKind.Passthrough, Section = section };
                continue;
            }

            if (phase == 0)
            {
                var t0 = PsseRaw.Tokenize(text, out var c0);
                if (t0.Count >= 3 && PsseRaw.TryInt(text, t0[2], out var rev) && rev > 0)
                {
                    Version = rev;
                    VersionFromFile = true;
                }
                phase = 1;
                yield return new RawLine { Text = text, Kind = LineKind.CaseId, Section = PsseSection.CaseId, Tokens = t0, CommentStart = c0 };
                continue;
            }
            if (phase is 1 or 2)
            {
                yield return new RawLine { Text = text, Kind = LineKind.Title, Section = PsseSection.CaseId, TitleIndex = phase };
                phase++;
                continue;
            }

            var tokens = PsseRaw.Tokenize(text, out var cs);

            if (remaining > 0)
            {
                remaining--;
                recordLine++;
                yield return new RawLine { Text = text, Kind = LineKind.Data, Section = section, RecordLine = recordLine, SubBlock = sub, Tokens = tokens, CommentStart = cs };
                continue;
            }

            if (firstData)
            {
                firstData = false;
                section = PsseRaw.IsSystemWideRecord(text, tokens) ? PsseSection.SystemWide : PsseSection.Bus;
            }

            if (tokens.Count == 1 && !tokens[0].Quoted && tokens[0].Text(text) is "Q" or "q")
            {
                phase = 4;
                yield return new RawLine { Text = text, Kind = LineKind.End, Section = PsseSection.End, Tokens = tokens, CommentStart = cs };
                continue;
            }

            if (tokens.Count == 1 && !tokens[0].Quoted && tokens[0].Text(text) == "0")
            {
                var label = cs < 0 ? "" : text[(cs + 1)..];
                yield return new RawLine { Text = text, Kind = LineKind.Terminator, Section = section, SubBlock = sub, Tokens = tokens, CommentStart = cs };

                if (section == PsseSection.Substation && sub > 0)
                {
                    sub = (sub + 1) % 4;
                    continue;
                }
                var labeled = PsseRaw.SectionFromLabel(label);
                if (labeled is { } next && next != PsseSection.Unknown)
                {
                    SawLabels = true;
                    section = next;
                }
                else
                {
                    if (labeled is null) SawUnlabeledTerminator = true;
                    section = PsseRaw.NextInOrder(Version, section);
                }
                sub = 0;
                continue;
            }

            // Start of a record: work out how many physical lines it spans.
            var lines = section switch
            {
                PsseSection.Transformer => tokens.Count > 2 && PsseRaw.TryInt(text, tokens[2], out var k) && k != 0 ? 5 : 4,
                PsseSection.TwoTerminalDc or PsseSection.VscDc => 3,
                PsseSection.MultiTerminalDc => 1 + IntAt(text, tokens, 1) + IntAt(text, tokens, 2) + IntAt(text, tokens, 3),
                _ => 1,
            };
            remaining = Math.Max(0, lines - 1);
            recordLine = 0;
            var thisSub = sub;
            if (section == PsseSection.Substation && sub == 0) sub = 1; // nodes follow each substation record
            yield return new RawLine { Text = text, Kind = LineKind.Data, Section = section, RecordLine = 0, SubBlock = thisSub, Tokens = tokens, CommentStart = cs };
        }
    }

    private static int IntAt(string line, List<RawToken> tokens, int i) =>
        i < tokens.Count && PsseRaw.TryInt(line, tokens[i], out var v) && v > 0 ? v : 0;
}
