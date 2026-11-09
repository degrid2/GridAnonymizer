using System.Text.RegularExpressions;
using GridAnonymizer.Engine;
using GridAnonymizer.Hashing;
using GridAnonymizer.Mapping;
using GridAnonymizer.Profiles;

namespace GridAnonymizer.Formats.Cim;

/// <summary>
/// Turns a merged inventory into replacement maps. This is a line-for-line port
/// of v1's <c>buildMaps</c>: for the default profile it produces the same
/// pseudonyms for the same salt, which the test suite checks against output of
/// the original TypeScript engine.
/// </summary>
internal static partial class CimMapBuilder
{
    [GeneratedRegex("_(COMB_CYC|CC|GT|ST|HYDRO|NUC|WIND|SOLAR)$", RegexOptions.IgnoreCase)]
    private static partial Regex TypeHintSuffix();

    [GeneratedRegex("_(BB|CP_BB|[A-Z]{1,3})$")]
    private static partial Regex ShortSuffix();

    [GeneratedRegex(@"_(\d{1,2})$")]
    private static partial Regex CircuitSuffix();

    [GeneratedRegex(@"^[\d.]+$")]
    private static partial Regex KvName();

    [GeneratedRegex(@"^\d+$")]
    private static partial Regex Digits();

    public static string LocalType(string qname) => qname[(qname.IndexOf(':') + 1)..];

    public static CimMaps Build(CimInventory inv, CimOptions o, GlobalRules rules, string salt, CimMapping? preloaded)
    {
        var maps = new CimMaps();
        if (preloaded is not null)
        {
            foreach (var p in preloaded.Ids) maps.Ids[p.Key] = p.Value;
            foreach (var p in preloaded.Names) maps.Names[p.Key] = p.Value;
            foreach (var p in preloaded.Mrids) maps.Mrids[p.Key] = p.Value;
            foreach (var p in preloaded.Descriptions) maps.Descs[p.Key] = p.Value;
            foreach (var p in preloaded.Preserved) maps.Preserved.Add(p);
        }

        var sensitive = new HashSet<string>(o.SensitiveClasses, StringComparer.Ordinal);
        var numericOk = new HashSet<string>(o.NumericNameClasses, StringComparer.Ordinal);
        string PrefixFor(string type) => o.ClassPrefixes.TryGetValue(LocalType(type), out var p) ? p : o.DefaultPrefix;
        bool IsSensitive(CimEntity e) => sensitive.Contains(LocalType(e.Type));

        var names = new NameCounter(maps.Names.Values);

        // Sensitive token dictionary: other objects' names embed substation/region names.
        var tokenOwner = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (id, e) in inv.Entities)
        {
            if (e.Name is null || !IsSensitive(e)) continue;
            foreach (Match w in CimPatterns.Word.Matches(e.Name))
            {
                var t = w.Value.ToUpperInvariant();
                if (t.Length >= 4) tokenOwner.TryAdd(t, id);
            }
            var whole = e.Name.ToUpperInvariant();
            if (whole.Length >= 4) tokenOwner.TryAdd(whole, id);
        }

        var sensitiveNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in inv.Entities.Values)
            if (e.Name is not null && IsSensitive(e)) sensitiveNames.Add(e.Name);

        // kV names are decided globally: a ConnectivityNode called "138" must not rename the 138 kV level.
        var kvNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in inv.Entities.Values)
            if (e.Name is not null && numericOk.Contains(LocalType(e.Type)) && KvName().IsMatch(e.Name.Trim()))
                kvNames.Add(e.Name);

        bool IsVocabulary(string name) =>
            rules.IsPreserved(name) ||
            (!sensitiveNames.Contains(name) &&
             (inv.NameCount.GetValueOrDefault(name) >= o.VocabularyMinCount || inv.VocabValues.Contains(name)));

        if (o.AnonymizeIds)
        {
            var keepIds = o.PreserveIdPatterns.Select(p => new Regex(p, RegexOptions.CultureInvariant)).ToArray();
            bool KeepId(string id) => keepIds.Length > 0 && Array.Exists(keepIds, r => r.IsMatch(id));
            foreach (var id in inv.Entities.Keys)
                if (!maps.Ids.ContainsKey(id) && !KeepId(id)) maps.Ids[id] = Pseudonym.NewIdFor(salt, id);
            foreach (var id in inv.ReferencedIds)
            {
                if (maps.Ids.ContainsKey(id) || !o.AnonymizeExternalReferences || KeepId(id) || inv.Entities.ContainsKey(id)) continue;
                maps.Ids[id] = Pseudonym.NewIdFor(salt, id);
                maps.ExternalCount++;
            }
        }

        if (o.AnonymizeNames)
        {
            // Sensitive objects first (stable), so their pseudonyms exist before dependents borrow them.
            var order = inv.Entities.OrderByDescending(kv => IsSensitive(kv.Value) ? 1 : 0).ToList();
            var newNameOfEntity = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var (id, e) in order)
            {
                if (e.Name is null) continue;
                var type = LocalType(e.Type);

                if (kvNames.Contains(e.Name) || IsVocabulary(e.Name))
                {
                    newNameOfEntity[id] = e.Name;
                    maps.Names[e.Name] = e.Name;
                    maps.Preserved.Add(e.Name);
                    continue;
                }
                if (maps.Names.TryGetValue(e.Name, out var existing) && !newNameOfEntity.ContainsKey(id))
                {
                    newNameOfEntity[id] = existing;
                    continue;
                }

                var prefix = PrefixFor(e.Type);
                string generated;

                var upper = e.Name.ToUpperInvariant();
                string? ownerId = null;
                var bestLen = 0;
                if (tokenOwner.TryGetValue(upper, out var wholeOwner)) { ownerId = wholeOwner; bestLen = upper.Length; }
                foreach (Match w in CimPatterns.Word.Matches(upper))
                {
                    if (!tokenOwner.TryGetValue(w.Value, out var owner) || owner == id) continue;
                    if (w.Value.Length > bestLen) { ownerId = owner; bestLen = w.Value.Length; }
                }
                if (ownerId == id) ownerId = null;

                if (ownerId is not null && !sensitive.Contains(type))
                {
                    var ownerEntity = inv.Entities.GetValueOrDefault(ownerId);
                    string ownerNew;
                    if (newNameOfEntity.TryGetValue(ownerId, out var a)) ownerNew = a;
                    else if (maps.Names.TryGetValue(ownerEntity?.Name ?? "", out var b)) ownerNew = b;
                    else ownerNew = names.NextName(PrefixFor(ownerEntity?.Type ?? "x:Substation"));

                    var seq = names.Next(ownerNew + "#");
                    generated = $"{ownerNew}_{prefix[0]}{seq.ToString().PadLeft(4, '0')}";
                    if (names.IsUsed(generated)) generated = names.NextName(prefix);
                    else names.MarkUsed(generated);
                }
                else if (o.KeepTypeHints && TypeHintSuffix().Match(e.Name) is { Success: true } hint)
                {
                    generated = names.NextName(prefix) + hint.Value.ToUpperInvariant();
                    names.MarkUsed(generated);
                }
                else
                {
                    generated = names.NextName(prefix);
                    var suf = ShortSuffix().Match(e.Name);
                    var circuit = CircuitSuffix().Match(e.Name);
                    if (suf.Success && !Digits().IsMatch(suf.Groups[1].Value)) generated = $"{generated}_{suf.Groups[1].Value}";
                    else if (circuit.Success) generated = $"{generated}_{circuit.Groups[1].Value}";
                }

                newNameOfEntity[id] = generated;
                maps.Names[e.Name] = generated;
            }
        }

        if (o.AnonymizeMrids && o.AnonymizeIds)
        {
            foreach (var (id, e) in inv.Entities)
            {
                if (e.Mrid is null || maps.Mrids.ContainsKey(e.Mrid)) continue;
                if (!maps.Ids.TryGetValue(id, out var newId)) continue;
                maps.Mrids[e.Mrid] = newId.StartsWith('_') ? newId[1..] : newId;
            }
        }

        if (o.AnonymizeDescriptions)
        {
            foreach (var (desc, count) in inv.DescCount)
            {
                if (maps.Descs.ContainsKey(desc)) continue;
                var isGeneric = (count >= o.VocabularyMinCount && !inv.NameSet.Contains(desc)) || rules.IsPreserved(desc);
                maps.Descs[desc] = isGeneric
                    ? desc
                    : maps.Names.TryGetValue(desc, out var asName) ? asName : "DESC_" + Pseudonym.HexDigest(salt, "d " + desc, 6);
            }
        }

        return maps;
    }
}
