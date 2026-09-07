export type LinkifySegment =
  | { type: "text"; value: string }
  | { type: "link"; href: string; display: string };

// Markdown links [label](url), bare http(s) URLs, and bare www. hosts.
const MD_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|www\.[^\s)]+)\)/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCT = /[)\].,;:!?'"]+$/;

function trimTrailing(raw: string): { trimmed: string; trailing: string } {
  let trimmed = raw;
  let trailing = "";
  while (trimmed) {
    const tm = trimmed.match(TRAILING_PUNCT);
    if (!tm) break;
    const cut = tm[0];
    trailing = cut + trailing;
    trimmed = trimmed.slice(0, -cut.length);
  }
  return { trimmed, trailing };
}

function toHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Bare URLs / www hosts inside a plain run of text. */
function linkifyPlain(text: string, segments: LinkifySegment[]): void {
  let lastIndex = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const { trimmed, trailing } = trimTrailing(raw);
    if (!trimmed) continue;

    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    segments.push({ type: "link", href: toHref(trimmed), display: trimmed });
    if (trailing) segments.push({ type: "text", value: trailing });
    lastIndex = start + raw.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
}

export function linkify(text: string): LinkifySegment[] {
  if (!text) return [];
  const segments: LinkifySegment[] = [];
  let lastIndex = 0;

  for (const m of text.matchAll(MD_LINK_RE)) {
    const start = m.index ?? 0;
    if (start > lastIndex) linkifyPlain(text.slice(lastIndex, start), segments);
    const label = m[1].trim();
    const { trimmed } = trimTrailing(m[2]);
    segments.push({ type: "link", href: toHref(trimmed || m[2]), display: label || trimmed });
    lastIndex = start + m[0].length;
  }

  if (lastIndex < text.length) linkifyPlain(text.slice(lastIndex), segments);
  return segments;
}

/** Reduce markdown links to their label so speech/copy stay clean. */
export function stripMarkdownLinks(text: string): string {
  return (text ?? "").replace(MD_LINK_RE, (_m, label: string) => label.trim());
}
