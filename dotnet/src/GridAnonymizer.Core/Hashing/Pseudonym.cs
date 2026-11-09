using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace GridAnonymizer.Hashing;

/// <summary>
/// Keyed, deterministic pseudonyms. Every replacement value the tool emits is
/// derived from HMAC-SHA256(salt, message), so the same salt always produces the
/// same output and files anonymized in separate runs still join.
/// </summary>
/// <remarks>
/// The message prefixes ("id ", "d ", "mas ") and the id shapes below are
/// identical to the v1 TypeScript engine, which keeps CIM output byte-compatible
/// with files produced by the original browser tool for the same salt.
/// </remarks>
public static partial class Pseudonym
{
    [ThreadStatic] private static string? _cachedSalt;
    [ThreadStatic] private static byte[]? _cachedKey;

    public static byte[] Hmac(string salt, string message)
    {
        if (!ReferenceEquals(salt, _cachedSalt))
        {
            _cachedKey = Encoding.UTF8.GetBytes(salt);
            _cachedSalt = salt;
        }
        return HMACSHA256.HashData(_cachedKey!, Encoding.UTF8.GetBytes(message));
    }

    public static string HexDigest(string salt, string message, int length) =>
        Convert.ToHexStringLower(Hmac(salt, message))[..length];

    /// <summary>A fresh random salt (128 bits, hex).</summary>
    public static string NewSalt() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));

    [GeneratedRegex("^_?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")]
    private static partial Regex UuidRegex();

    [GeneratedRegex(@"^(_)(\d+)((?:_\d+)*)$")]
    private static partial Regex NumericIdRegex();

    /// <summary>
    /// Format-preserving identifier: a UUID stays a UUID, <c>_123</c> stays a
    /// numeric <c>_NNNNNNNNNN</c>, a <c>urn:uuid:</c> stays a URN; anything else
    /// becomes <c>_</c> + 24 hex characters.
    /// </summary>
    public static string NewIdFor(string salt, string oldId)
    {
        if (oldId.StartsWith("urn:uuid:", StringComparison.Ordinal))
        {
            var inner = NewIdFor(salt, oldId[9..]);
            return "urn:uuid:" + (inner.StartsWith('_') ? inner[1..] : inner);
        }

        if (UuidRegex().IsMatch(oldId))
        {
            var h = Convert.ToHexStringLower(Hmac(salt, "id " + oldId));
            var variant = ((Convert.ToInt32(h[16].ToString(), 16) & 0x3) | 0x8).ToString("x");
            var uuid = $"{h[..8]}-{h[8..12]}-4{h[13..16]}-{variant}{h[17..20]}-{h[20..32]}";
            return oldId.StartsWith('_') ? "_" + uuid : uuid;
        }

        var m = NumericIdRegex().Match(oldId);
        if (m.Success)
        {
            var h = Hmac(salt, "id " + oldId);
            var sb = new StringBuilder("_");
            sb.Append((h[9] % 9) + 1);
            for (var i = 0; i < 9; i++) sb.Append(h[i] % 10);
            sb.Append(m.Groups[3].Value);
            return sb.ToString();
        }

        return "_" + HexDigest(salt, "id " + oldId, 24);
    }
}
