/**
 * Strip markdown decoration from AI chat output so replies render as plain text.
 *
 * Kept: numbered lists (1. …), emojis, punctuation, blank lines between
 * paragraphs. Removed: bold/italic markers, headings, bullet markers, code
 * fences/backticks, blockquote markers, horizontal rules.
 */
export function toPlainText(input: string | null | undefined): string {
  let t = input ?? "";
  if (!t) return "";

  // Code fences / inline backticks — keep the inner text.
  t = t.replace(/```[a-zA-Z0-9]*\n?/g, "").replace(/`+/g, "");

  // Bold / italic / strikethrough markers.
  t = t.replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  t = t.replace(/\*([^*\n]+)\*/g, "$1");
  t = t.replace(/___([^_\n]+)___/g, "$1");
  t = t.replace(/__([^_\n]+)__/g, "$1");
  t = t.replace(/(^|\s)_([^_\n]+)_(?=$|[\s.,!?;:])/g, "$1$2");
  t = t.replace(/~~([^~\n]+)~~/g, "$1");
  // Any leftover stray emphasis characters used as decoration.
  t = t.replace(/\*+/g, "");

  const lines = t.split("\n").map((line) => {
    let l = line;
    // Headings: "### Title" → "Title"
    l = l.replace(/^\s{0,3}#{1,6}\s+/, "");
    // Blockquotes.
    l = l.replace(/^\s{0,3}>+\s?/, "");
    // Horizontal rules.
    if (/^\s{0,3}([-_=]\s*){3,}$/.test(l)) return "";
    // Bullet markers (numbered lists are preserved).
    l = l.replace(/^\s*[-•+‣▪]\s+/, "");
    return l.replace(/\s+$/, "");
  });

  t = lines.join("\n");
  // Collapse 3+ newlines to a single blank line.
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
