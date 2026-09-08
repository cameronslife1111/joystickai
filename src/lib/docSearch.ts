/**
 * Emoji-safe search matching.
 *
 * Some titles use the bare glyph (⚪ U+26AA) while the filter buttons use the
 * emoji-presentation form (⚪️ = U+26AA + U+FE0F). A plain substring test then
 * fails and the list shows "No matches". Stripping variation selectors (and
 * keycap/ZWJ noise) from both sides makes them compare equal.
 */
export function normalizeSearch(s: string): string {
  return (s ?? "")
    .normalize("NFC")
    .replace(/[\uFE0E\uFE0F\u200D]/g, "")
    .toLowerCase()
    .trim();
}

/** True when `query` (already raw user text) matches `title`. */
export function matchesTitle(title: string, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  return normalizeSearch(title).includes(q);
}
