/**
 * Split a block of text into sentences. Mirrors src/lib/sentences.ts so text
 * written by Orby is stored the same way the in-app editor stores it (one
 * sentence per row), keeping sentence counts correct without a manual re-save.
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
      const next = cleaned[i + 1];
      while (
        i + 1 < cleaned.length &&
        (cleaned[i + 1] === "." || cleaned[i + 1] === "!" || cleaned[i + 1] === "?")
      ) {
        i++;
        buf += cleaned[i];
      }
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
