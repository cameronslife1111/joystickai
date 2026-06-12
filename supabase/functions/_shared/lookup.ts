// Shared, emoji- and shortcode-aware lookup helpers used by both the planner
// (plan-compose) and the executor (plan-step). The old tokenizers split on
// /[^a-z0-9]+/ which silently deleted emojis and punctuation, making it
// impossible to resolve references like "the doc that starts with the blue
// circle" or "the lowest X shortcode". These helpers fix that.

// Map natural-language emoji names to the actual glyphs. Extensible; NOT tied to
// any specific document title. Keys are matched as whole phrases in lowercased
// text. Order longer phrases before their shorter substrings.
export const EMOJI_SYNONYMS: Array<[RegExp, string]> = [
  [/\bred circle\b/gi, "🔴"],
  [/\bblue circle\b/gi, "🔵"],
  [/\bgreen circle\b/gi, "🟢"],
  [/\byellow circle\b/gi, "🟡"],
  [/\borange circle\b/gi, "🟠"],
  [/\bpurple circle\b/gi, "🟣"],
  [/\bbrown circle\b/gi, "🟤"],
  [/\bblack circle\b/gi, "⚫"],
  [/\bwhite circle\b/gi, "⚪"],
  [/\bred (dot|ball|bullet)\b/gi, "🔴"],
  [/\bblue (dot|ball|bullet)\b/gi, "🔵"],
  [/\bgreen (dot|ball|bullet)\b/gi, "🟢"],
  [/\bgreen (square|check ?box)\b/gi, "🟩"],
  [/\bcheck ?mark\b/gi, "✅"],
  [/\b(green )?check\b/gi, "✅"],
  [/\bcross mark\b/gi, "❌"],
  [/\bfire\b/gi, "🔥"],
  [/\bstar\b/gi, "⭐"],
  [/\bheart\b/gi, "❤️"],
  [/\b(laughing|laugh|crying laughing|lol|joy)\b/gi, "😂"],
  [/\bwastebasket|trash can|garbage\b/gi, "🗑️"],
];

// Replace emoji-name phrases in free text with their glyph so downstream
// substring/scoring sees the actual emoji a title uses.
export function applyEmojiSynonyms(text: string): string {
  let out = String(text ?? "");
  for (const [re, glyph] of EMOJI_SYNONYMS) out = out.replace(re, glyph);
  return out;
}

const EMOJI_RE = /\p{Extended_Pictographic}(\u{200D}\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{20E3}])*/u;

// Extract the first emoji/symbol cluster from a title (handles ZWJ + skin tones
// + variation selectors via Intl.Segmenter when available).
export function leadingEmoji(title: string): string | null {
  const t = String(title ?? "").trim();
  if (!t) return null;
  // Find the first pictographic cluster anywhere near the start (titles often
  // begin with an emoji but may have a leading space or two).
  const head = t.slice(0, 8);
  const m = head.match(EMOJI_RE);
  return m ? m[0] : null;
}

// Return every emoji glyph present in a title (deduped, order preserved).
export function allEmojis(title: string): string[] {
  const t = String(title ?? "");
  const re = new RegExp(EMOJI_RE.source, "gu");
  const found = t.match(re) ?? [];
  return [...new Set(found)];
}

export type Shortcode = { raw: string; letter: string; num: number };

// Pull a shortcode like "X597" out of a title. Pattern: a single letter
// followed by 2-6 digits, bounded by non-alphanumerics. Returns the first match.
export function extractShortcode(title: string): Shortcode | null {
  const t = String(title ?? "");
  const m = t.match(/(?<![A-Za-z0-9])([A-Za-z])(\d{2,6})(?![A-Za-z0-9])/);
  if (!m) return null;
  return { raw: `${m[1]}${m[2]}`, letter: m[1].toUpperCase(), num: parseInt(m[2], 10) };
}

// Emoji-preserving tokenizer. Keeps word tokens AND any emoji glyphs AND the
// shortcode token, so scoring can reward emoji/shortcode matches.
export function tokenizeRich(s: string, stopwords?: Set<string>): string[] {
  const text = String(s ?? "");
  const tokens: string[] = [];
  // Word tokens
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/i)) {
    if (w.length >= 2 && !(stopwords && stopwords.has(w))) tokens.push(w);
  }
  // Emoji tokens
  for (const e of allEmojis(text)) tokens.push(e);
  // Shortcode token (normalized lowercase, e.g. "x597")
  const sc = extractShortcode(text);
  if (sc) tokens.push(sc.raw.toLowerCase());
  return tokens;
}
