## Goal
Everywhere the app shows a list of documents (search pop-up, favorites slot picker, link-to-doc dialog, document picker sheet, destination picker), sort them consistently:
- Titles starting with **emoji** first
- Titles starting with **numbers** next
- Titles starting with **letters** last (A–Z, case-insensitive)

## Why
Right now the lists use whatever order the database returns (`position` or `updated_at`), so with 300+ documents the user has to hunt through a scattered list.

## Technical details
1. **Add a shared sort helper** in `src/lib/utils.ts` (or a new `src/lib/sortDocs.ts`):
   ```ts
   function docSortRank(title: string): number {
     const t = title.trim();
     if (/^\p{Extended_Pictographic}/u.test(t)) return 0; // emoji
     if (/^\d/.test(t)) return 1;                         // number
     return 2;                                             // letter / other
   }
   export function sortDocsByTitle<T extends { title: string }>(docs: T[]): T[] {
     return [...docs].sort((a, b) => {
       const ra = docSortRank(a.title);
       const rb = docSortRank(b.title);
       if (ra !== rb) return ra - rb;
       return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
     });
   }
   ```

2. **Apply sorting in every document-list UI** — each location gets `.slice()` or `[...docs]` before mapping so the original array isn't mutated:
   - `app.tsx` — favorites picker `filtered` list (line ~1469) and search pop-up `results` (line ~1578)
   - `LinkDocumentDialog.tsx` — `filtered` list (line ~40)
   - `DocumentPickerSheet.tsx` — the fetched `documents` before they are rendered
   - `DestinationPicker.tsx` — the `documents` prop before rendering in the `Select`

3. **No database changes** — purely client-side sort at render time.

## Files touched
- `src/lib/utils.ts` (add helper) or `src/lib/sortDocs.ts` (new file)
- `src/routes/_authenticated/app.tsx`
- `src/components/LinkDocumentDialog.tsx`
- `src/components/DocumentPickerSheet.tsx`
- `src/components/DestinationPicker.tsx`
