/**
 * Split a block of text into sentences.
 * Handles ., !, ? terminators and preserves common abbreviations.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "e.g", "i.e",
  "a.m", "p.m", "u.s", "u.k", "no", "inc", "ltd", "co",
]);

export function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const result: string[] = [];
  let buf = "";
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    buf += ch;
    if (ch === "." || ch === "!" || ch === "?") {
      // peek next
      const next = cleaned[i + 1];
      // skip repeated punctuation
      while (
        i + 1 < cleaned.length &&
        (cleaned[i + 1] === "." || cleaned[i + 1] === "!" || cleaned[i + 1] === "?")
      ) {
        i++;
        buf += cleaned[i];
      }
      // abbreviation check
      const lastWord = buf.trim().split(/\s+/).pop() ?? "";
      const wordNoPunct = lastWord.replace(/[.!?]+$/, "").toLowerCase();
      if (ABBREVIATIONS.has(wordNoPunct)) continue;

      if (!next || next === " ") {
        const s = buf.trim();
        if (s) result.push(s);
        buf = "";
      }
    }
  }
  const tail = buf.trim();
  if (tail) result.push(tail);
  return result;
}
