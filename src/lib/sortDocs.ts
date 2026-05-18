function docSortRank(title: string): number {
  const t = (title ?? "").trim();
  if (!t) return 3;
  if (/^\p{Extended_Pictographic}/u.test(t)) return 0; // emoji first
  if (/^\d/.test(t)) return 1; // numbers next
  if (/^\p{L}/u.test(t)) return 2; // letters
  return 3; // other (punctuation, etc.)
}

export function sortDocsByTitle<T extends { title: string }>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const ra = docSortRank(a.title);
    const rb = docSortRank(b.title);
    if (ra !== rb) return ra - rb;
    return (a.title ?? "").localeCompare(b.title ?? "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}
