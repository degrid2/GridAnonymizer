namespace GridAnonymizer.IO;

/// <summary>
/// Reads XML text in large chunks without ever splitting a construct the rewrite
/// rules match on. Memory stays proportional to the chunk size, not the file.
/// </summary>
/// <remarks>
/// A chunk always ends immediately before an <em>opening</em> '&lt;' (never before
/// '&lt;/'), so an element's start tag, its text and the '&lt;' of its end tag are
/// always in the same chunk. A chunk also never ends inside a comment or CDATA
/// section. (The v1 engine cut before any '&lt;', which could separate
/// <c>&lt;name&gt;VALUE</c> from its closing tag and let the value through.)
/// </remarks>
public static class XmlChunker
{
    public const int DefaultChunkSize = 1 << 20;

    /// <summary>Test hook: force tiny chunks to exercise boundary handling.</summary>
    internal static int? ChunkSizeOverride { get; set; }

    public static IEnumerable<string> Read(TextReader reader, int chunkSize = DefaultChunkSize, Action<long>? onCharsRead = null)
    {
        var buffer = new char[ChunkSizeOverride ?? chunkSize];
        var carry = string.Empty;
        long total = 0;
        int read;
        while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
        {
            total += read;
            onCharsRead?.Invoke(total);
            var text = carry + new string(buffer, 0, read);
            var cut = SafeCut(text);
            if (cut <= 0)
            {
                carry = text;
                continue;
            }
            carry = text[cut..];
            yield return text[..cut];
        }
        if (carry.Length > 0) yield return carry;
    }

    /// <summary>Index of the last safe split point, or -1 if none.</summary>
    internal static int SafeCut(string text)
    {
        var cut = text.Length;
        for (; ; )
        {
            cut = text.LastIndexOf('<', cut - 1);
            if (cut <= 0) return -1;
            if (cut + 1 < text.Length && text[cut + 1] == '/') continue; // a closing tag: keep it with its element
            if (cut + 1 >= text.Length) continue;                          // can't tell yet
            break;
        }

        // Never end a chunk inside an open comment or CDATA section.
        var head = text.AsSpan(0, cut);
        var openComment = head.LastIndexOf("<!--");
        if (openComment >= 0 && head[openComment..].IndexOf("-->") < 0) cut = openComment;
        var openCdata = text.AsSpan(0, cut).LastIndexOf("<![CDATA[");
        if (openCdata >= 0 && text.AsSpan(openCdata, cut - openCdata).IndexOf("]]>") < 0) cut = openCdata;
        return cut;
    }
}
