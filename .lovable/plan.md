## Goal
Show the same row of emoji quick-filter buttons (🐝 🟣 🔵 🔴 🟢 🟡 🟠 🟤) — that already exist in the document picker/link dialogs — inside the two search pop-ups on the main app screen that are currently missing them. Tapping an emoji enters that emoji into the search text box, which immediately narrows the results.

## Where they're missing (both in `src/routes/_authenticated/app.tsx`)
1. **The main "🔍 Search docs" pop-up** (`searchOpen` overlay, around lines 2286–2360). Uses `searchQuery` / `setSearchQuery`.
2. **The favorites slot picker** — the pop-up shown when you pick/select a favorites slot (`pickerSlot` overlay, around lines 2152–2280). Uses `pickerQuery` / `setPickerQuery`.

## What gets added
- A shared `EMOJI_FILTERS` constant (`["🐝","🟣","🔵","🔴","🟢","🟡","🟠","🟤"]`) defined once at the top of the file.
- A small horizontal row of 8 `type="button"` emoji buttons rendered directly **above** the existing search `<input>` in each of the two pop-ups.
- On press:
  - In the Search-docs pop-up the button calls `setSearchQuery(emoji)`.
  - In the favorites slot picker the button calls `setPickerQuery(emoji)`.
  - This replaces the current text (matching the "replace the search" behavior already used in the other dialogs). Both lists already filter reactively from their query value, so results narrow automatically — no filter-logic changes.
- Buttons reuse the existing token-based styling (border + `bg-foreground/5`, rounded) so they match the current look, and wrap to stay tap-friendly on the 390px mobile viewport.

## Behavior notes
- Tapping a different emoji replaces the previous one (single-emoji filter at a time); the user can still type manually afterward.
- Buttons are `type="button"` so they never submit or close the pop-up.

## Out of scope
No backend, data, routing, or filtering-algorithm changes — only the two presentation pop-ups in `app.tsx` get the emoji button row.