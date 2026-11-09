namespace GridAnonymizer.Profiles;

/// <summary>
/// Everything a customer can tune without touching code. Profiles are plain JSON;
/// <c>gridanon profile init</c> writes this default with every field spelled out.
/// A property omitted from a JSON profile keeps the default shown here.
/// </summary>
public sealed class AnonymizationProfile
{
    public string Name { get; set; } = "default";
    public string? Description { get; set; } = "Built-in defaults: rename identifying names and ids, keep electrical data intact.";

    /// <summary>Regular expressions. A name matching any of these is never renamed, in any format.</summary>
    public List<string> PreserveNames { get; set; } = [];

    /// <summary>
    /// Literal terms (case-insensitive) that must not survive anywhere in names,
    /// descriptions, strings or comments - e.g. the utility's own name. Matches
    /// are replaced with <see cref="RedactionText"/>, and the audit hunts for them.
    /// </summary>
    public List<string> RedactTerms { get; set; } = [];

    public string RedactionText { get; set; } = "REDACTED";

    public CimOptions Cim { get; set; } = new();
    public PsseOptions Psse { get; set; } = new();
    public TextOptions Text { get; set; } = new();
}

public sealed class CimOptions
{
    public bool AnonymizeIds { get; set; } = true;

    /// <summary>
    /// Also remap ids that are referenced but not declared in any input file. Turn
    /// off for CGMES sets that point into the public ENTSO-E boundary set, so the
    /// anonymized model still merges with the official boundary.
    /// </summary>
    public bool AnonymizeExternalReferences { get; set; } = true;

    /// <summary>Regular expressions; ids matching any of these are kept unchanged.</summary>
    public List<string> PreserveIdPatterns { get; set; } = [];

    public bool AnonymizeNames { get; set; } = true;
    public bool AnonymizeMrids { get; set; } = true;
    public bool AnonymizeDescriptions { get; set; } = true;
    public bool StripComments { get; set; } = true;
    public bool ReplaceHeaders { get; set; } = true;

    /// <summary>Keep generation-type suffixes such as _CC, _GT, _HYDRO, _WIND on renamed units.</summary>
    public bool KeepTypeHints { get; set; }

    /// <summary>A label shared by at least this many objects is vocabulary, not identity, and is kept.</summary>
    public int VocabularyMinCount { get; set; } = 20;

    /// <summary>Classes whose names identify places or assets. Other objects named after them inherit the pseudonym.</summary>
    public List<string> SensitiveClasses { get; set; } =
    [
        "Substation", "GeographicalRegion", "SubGeographicalRegion", "Line", "ControlArea",
        "Organisation", "OperatingCompany",
        "GeneratingUnit", "ThermalGeneratingUnit", "HydroGeneratingUnit", "NuclearGeneratingUnit",
    ];

    /// <summary>Classes whose purely numeric names are kV levels and are kept.</summary>
    public List<string> NumericNameClasses { get; set; } = ["VoltageLevel", "BaseVoltage"];

    /// <summary>Pseudonym prefix by CIM class (local name).</summary>
    public Dictionary<string, string> ClassPrefixes { get; set; } = new()
    {
        ["Substation"] = "SUB",
        ["VoltageLevel"] = "VL",
        ["Bay"] = "BAY",
        ["BusbarSection"] = "BUS",
        ["Breaker"] = "BKR",
        ["Disconnector"] = "DSC",
        ["GroundDisconnector"] = "GDS",
        ["LoadBreakSwitch"] = "LBS",
        ["Switch"] = "SW",
        ["Jumper"] = "JMP",
        ["Fuse"] = "FUS",
        ["ACLineSegment"] = "LN",
        ["Line"] = "LN",
        ["PowerTransformer"] = "TR",
        ["TransformerWinding"] = "TRW",
        ["PowerTransformerEnd"] = "TRE",
        ["RatioTapChanger"] = "RTC",
        ["PhaseTapChanger"] = "PTC",
        ["SynchronousMachine"] = "GEN",
        ["AsynchronousMachine"] = "AGEN",
        ["GeneratingUnit"] = "GU",
        ["ThermalGeneratingUnit"] = "GU",
        ["HydroGeneratingUnit"] = "GU",
        ["NuclearGeneratingUnit"] = "GU",
        ["WindGeneratingUnit"] = "GU",
        ["SolarGeneratingUnit"] = "GU",
        ["EnergyConsumer"] = "LOAD",
        ["ConformLoad"] = "LOAD",
        ["NonConformLoad"] = "LOAD",
        ["StationSupply"] = "AUX",
        ["EnergySource"] = "SRC",
        ["ExternalNetworkInjection"] = "INJ",
        ["EquivalentInjection"] = "EQI",
        ["EquivalentBranch"] = "EQB",
        ["ShuntCompensator"] = "SH",
        ["LinearShuntCompensator"] = "SH",
        ["NonlinearShuntCompensator"] = "SH",
        ["StaticVarCompensator"] = "SVC",
        ["SeriesCompensator"] = "SC",
        ["ConnectivityNode"] = "CN",
        ["TopologicalNode"] = "TN",
        ["Terminal"] = "T",
        ["GeographicalRegion"] = "REG",
        ["SubGeographicalRegion"] = "SREG",
        ["ControlArea"] = "CA",
        ["OperationalLimitSet"] = "OLS",
        ["CurrentLimit"] = "CL",
        ["VoltageLimit"] = "VL_LIM",
        ["ActivePowerLimit"] = "APL",
        ["ApparentPowerLimit"] = "SPL",
        ["Measurement"] = "MEAS",
        ["Analog"] = "ANA",
        ["Discrete"] = "DISC",
    };

    public string DefaultPrefix { get; set; } = "OBJ";

    /// <summary>Property local names (without namespace prefix) treated as an object's name.</summary>
    public List<string> NameProperties { get; set; } = ["IdentifiedObject.name"];

    /// <summary>Free-text properties; replaced by the matching name pseudonym or a hashed DESC_xxxxxx.</summary>
    public List<string> DescriptionProperties { get; set; } =
        ["IdentifiedObject.description", "IdentifiedObject.aliasName", "IdentifiedObject.shortName"];

    /// <summary>
    /// Model-header properties (qualified name) and their replacement. <c>{hash8}</c> expands to
    /// 8 hex characters keyed on the original value, so distinct authorities stay distinct.
    /// </summary>
    public Dictionary<string, string> HeaderProperties { get; set; } = new()
    {
        ["md:Model.description"] = "Anonymized CIM model",
        ["md:Model.modelingAuthoritySet"] = "http://anonymized.invalid/{hash8}",
    };

    /// <summary>
    /// Properties (local name) whose value is overwritten outright - coordinates and
    /// addresses (CGMES GL profile, IEC 61968 Location) are the usual suspects.
    /// </summary>
    public Dictionary<string, string> OverwriteProperties { get; set; } = new()
    {
        ["PositionPoint.xPosition"] = "0",
        ["PositionPoint.yPosition"] = "0",
        ["PositionPoint.zPosition"] = "0",
        ["StreetDetail.name"] = "",
        ["StreetDetail.number"] = "",
        ["StreetDetail.addressGeneral"] = "",
        ["TownDetail.name"] = "",
        ["TownDetail.code"] = "",
        ["StreetAddress.postalCode"] = "",
    };
}

public sealed class PsseOptions
{
    public bool AnonymizeNames { get; set; } = true;
    public bool ReplaceCaseTitle { get; set; } = true;
    public string CaseTitle { get; set; } = "ANONYMIZED CASE";
    public bool StripComments { get; set; } = true;

    /// <summary>Renumber buses everywhere they are referenced. Off by default because it changes every study script that names a bus.</summary>
    public bool RenumberBuses { get; set; }

    /// <summary>"sequential" keeps file order; "shuffled" assigns numbers in a salt-keyed random order.</summary>
    public string BusNumberStrategy { get; set; } = "shuffled";

    public int BusNumberStart { get; set; } = 1;

    /// <summary>Zero substation latitude/longitude (v34+ substation data).</summary>
    public bool ZeroCoordinates { get; set; } = true;

    /// <summary>
    /// Quoted strings matching any of these regexes are kept: circuit/machine/load ids
    /// (1-2 characters) and transformer vector groups are data, not identity.
    /// </summary>
    public List<string> KeepStringPatterns { get; set; } =
    [
        @"^\s*\S{0,2}\s*$",
        @"^\s*[YyDdZz][Nn]?(\s*[YyDdZz][Nn]?\d{1,2})+\s*$",
    ];

    /// <summary>Pseudonym prefix by section. Keep these short: PSS/E names are at most 12 characters.</summary>
    public Dictionary<string, string> NamePrefixes { get; set; } = new()
    {
        ["bus"] = "BUS",
        ["branch"] = "BR",
        ["transformer"] = "XF",
        ["area"] = "AREA",
        ["zone"] = "ZONE",
        ["owner"] = "OWNER",
        ["two-terminal-dc"] = "DC",
        ["vsc-dc"] = "VSC",
        ["multi-terminal-dc"] = "MTDC",
        ["facts"] = "FACTS",
        ["switched-shunt"] = "SWSH",
        ["gne"] = "GNE",
        ["substation"] = "SUB",
        ["substation-node"] = "NODE",
        ["substation-switching-device"] = "SWD",
        ["switching-device"] = "SWD",
        ["induction-machine"] = "IM",
        ["default"] = "NAME",
    };
}

public sealed class TextOptions
{
    /// <summary>Only replace mapped names at least this long when rewriting arbitrary text files.</summary>
    public int MinNameLength { get; set; } = 3;
}
