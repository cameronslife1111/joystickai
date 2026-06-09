## Goal
Add a row of 8 emoji quick-filter buttons to the top of both document-search pop-ups, above the "Search documents…" box. Tapping an emoji sets the search box to that emoji (replacing any current text), which immediately narrows the list to documents whose titles contain that emoji.

## Emojis (in order)
🐝 🟣 🔵 🔴 🟢 🟡 🟠 🟤

## Files to change
1. `src/components/LinkDocumentDialog.tsx` — the "Link this sentence" pop-up.
2. `src/components/DocumentPickerSheet.tsx` — the "Attach documents" bottom sheet.

## What gets added (both files)
- A small horizontal row of 8 buttons rendered directly above the existing `<Input>` search field.
- Each button shows one emoji. On press it calls `setQuery(emoji)` — replacing whatever is currently typed.
- Because both dialogs already filter the list reactively from `query` (`LinkDocumentDialog` via the `filtered` memo using `title.includes(q)`; `DocumentPickerSheet` the same), setting the query is all that's needed — the existing filtering logic narrows the results automatically. No filter logic changes.
- Buttons are `type="button"` so they never submit/close the dialog, and reuse existing token-based styling (border + `bg-foreground/5`, rounded) to match the current look. The row wraps and stays tap-friendly on the 390px mobile viewport.

## Behavior notes
- Tapping a different emoji replaces the previous one (single-emoji filter at a time), matching the "replace the search" choice.
- The user can still type manually afterward; the emoji button just pre-fills the box.
- Both dialogs already reset `query` to "" when opened, so no state cleanup changes are required.

## Out of scope
No backend, data, routing, or filtering-algorithm changes — only the two presentation components get the emoji button row.