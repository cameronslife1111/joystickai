## 1. Fix duplicate "New doc" in menu slots 2 & 3

In `src/routes/_authenticated/app.tsx` (~line 1105), slot 2 (`filled[1]`) and slot 3 (`filled[2]`) both point to `grid[5]`, which is the "New doc" action — that's why two New doc buttons appear. The intent (per the comment) was Rename in slot 2 and New doc in slot 3.

Change:
```
filled[1] = grid[6];   // 2  Rename
filled[2] = grid[5];   // 3  New doc
```
(grid[6] is the `✏️ Rename` entry.) No other slot mapping changes.

## 2. Add search to the favorites slot picker

Currently when the user taps a Favorites slot, a sheet lists all 300+ docs unfiltered. Add a search input at the top of that picker (lines ~1467–1516 of `app.tsx`).

- New local state `pickerQuery` (string), reset to `""` whenever `pickerSlot` opens or closes.
- Render a sticky search `<input>` at the top of the sheet styled to match the existing dark-glass UI (rounded, border `border-foreground/10`, bg `bg-foreground/5`, autoFocus).
- Filter `(docs ?? [])` by case-insensitive `title.includes(query)` before mapping to buttons.
- "Clear slot" stays above the search (always visible when slot is filled), or moves to a small pinned row — keep it above the search so destructive action is never hidden by typed text. The filtered list scrolls beneath.
- Empty filter result shows "No matches" in muted text.

## 3. Add "Replace all matching slots" button

Below the existing "Clear slot" button (only shown when `favorites[pickerSlot]` is set), add a second button:

- Label: `Replace all matching slots`
- Style: matches Clear slot's outlined look but neutral (e.g. `border-foreground/20 bg-foreground/5`, not destructive red).
- Behavior: capture `targetId = favorites[pickerSlot]`. When the user then picks a doc `d` from the list, instead of writing only `next[pickerSlot] = d.id`, replace **every** slot whose current value equals `targetId` with `d.id`, then save.
- Implement via a new state flag `replaceMatching: boolean` (default `false`). Tapping the button toggles it on and shows a small hint above the doc list ("Picking a doc will replace all N slots currently set to '<title>'"). Tapping a doc then performs the multi-slot replace and resets the flag.
- Reset `replaceMatching` to `false` whenever `pickerSlot` changes or the picker closes.
- If the target doc was deleted/missing, fall back to a single-slot replace.

No backend changes (favorites are already stored as a JSON array on `user_preferences` via the existing `saveFavorites`). No new components, no schema changes — all edits are in `src/routes/_authenticated/app.tsx`.

## Files touched
- `src/routes/_authenticated/app.tsx` (slots map fix, picker search input, replace-all button + flag)
