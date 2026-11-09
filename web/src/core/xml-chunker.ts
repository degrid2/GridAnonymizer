/**
 * Reads XML text in large chunks without ever splitting a construct the rewrite
 * rules match on. Same rule as the .NET XmlChunker: a chunk ends immediately
 * before an opening '<' (never '</'), and never inside a comment or CDATA.
 */

export const DEFAULT_CHUNK = 1 << 20;
export const chunkConfig = { size: DEFAULT_CHUNK };

export function safeCut(text: string): number {
  let cut = text.length;
  for (;;) {
    cut = cut - 1 < 0 ? -1 : text.lastIndexOf('<', cut - 1);
    if (cut <= 0) return -1;
    if (cut + 1 < text.length && text[cut + 1] === '/') continue;
    if (cut + 1 >= text.length) continue;
    break;
  }
  // Never end a chunk inside an open comment or CDATA section.
  const head = text.slice(0, cut);
  const openComment = head.lastIndexOf('<!--');
  if (openComment >= 0 && head.indexOf('-->', openComment) < 0) cut = openComment;
  const openCdata = text.slice(0, cut).lastIndexOf('<![CDATA[');
  if (openCdata >= 0 && text.slice(openCdata, cut).indexOf(']]>') < 0) cut = openCdata;
  return cut;
}

export async function* xmlChunks(text: AsyncIterable<string>): AsyncGenerator<string> {
  let carry = '';
  for await (const piece of text) {
    carry += piece;
    if (carry.length < chunkConfig.size) continue;
    const cut = safeCut(carry);
    if (cut <= 0) continue;
    yield carry.slice(0, cut);
    carry = carry.slice(cut);
  }
  if (carry.length > 0) yield carry;
}
