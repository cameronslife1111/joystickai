export type LinkifySegment =
  | { type: "text"; value: string }
  | { type: "link"; href: string; display: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCT = /[)\].,;:!?'"]+$/;

export function linkify(text: string): LinkifySegment[] {
  if (!text) return [];
  const segments: LinkifySegment[] = [];
  let lastIndex = 0;

  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];

    let trimmed = raw;
    let trailing = "";
    while (true) {
      const tm = trimmed.match(TRAILING_PUNCT);
      if (!tm) break;
      const cut = tm[0];
      trailing = cut + trailing;
      trimmed = trimmed.slice(0, -cut.length);
      if (!trimmed) break;
    }

    if (!trimmed) continue;

    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    segments.push({ type: "link", href: trimmed, display: trimmed });
    if (trailing) {
      segments.push({ type: "text", value: trailing });
    }
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}
