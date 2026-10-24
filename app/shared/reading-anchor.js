import { decodeHTML } from 'entities';
// Canonical text is identical to a sanitized reader's textContent, not layout-dependent offsets.
export const readingText = (html) =>
  decodeHTML(html.replace(/<(?:"[^"]*"|'[^']*'|[^'">])*>/g, '')).replace(/\u00a0/g, ' ');
export function resolveAnchor(text, anchor, hash) {
  if (hash === anchor.hash && text.slice(anchor.start, anchor.end) === anchor.quote)
    return { state: 'exact', start: anchor.start, end: anchor.end };
  const matches = [];
  for (let at = text.indexOf(anchor.quote); at >= 0; at = text.indexOf(anchor.quote, at + 1)) {
    if (
      (!anchor.prefix ||
        text.slice(Math.max(0, at - anchor.prefix.length), at) === anchor.prefix) &&
      (!anchor.suffix ||
        text.slice(at + anchor.quote.length, at + anchor.quote.length + anchor.suffix.length) ===
          anchor.suffix)
    )
      matches.push(at);
    if (matches.length > 1) break;
  }
  return matches.length === 1
    ? { state: 'relocated', start: matches[0], end: matches[0] + anchor.quote.length }
    : { state: matches.length ? 'ambiguous' : 'missing', start: null, end: null };
}
