## Split favorites row into "open" + "edit slot" actions

In the favorites popup (slot 16), each row currently does only one thing: it opens the slot picker. Change it so:

- Tapping the row itself **opens that document** (sets it active, jumps to its saved sentence position, and triggers web speech of the current sentence — same behavior as cycling to it via swipe-right), then closes the favorites popup.
- A **separate small button on the right** of the row opens the existing slot picker (the current "change which document is in this slot" flow). This replaces the current `›` chevron with a tappable edit affordance (e.g. a pencil/`✎` icon button).
- Empty slots keep their current behavior: tapping anywhere on the row opens the picker to assign a document (no doc to open).

Nothing else changes: lock state, swipe behavior, mute, slot-picker contents, "Replace all matching slots", clear-slot, swap slot, etc. all stay exactly as they are.

### Implementation notes (technical)

In `src/routes/_authenticated/app.tsx` around lines 1735–1758:

1. Add a new `openFavoriteSlot(i: number)` handler defined inside the popup render (or as a `useCallback` near `swapSlot`). It mirrors the favorites branch of `onSwipeRight` (lines ~598–643):
   - `const token = claimSpeech();`
   - Parallel-fetch `documents.current_sentence_index, title` + ordered `sentences` rows for `favorites[i]`.
   - Bail if `token !== speechTokenRef.current`.
   - Clamp `savedIdx` into the sentences list; prime `qc.setQueryData(["sentences", targetId], list)` and patch `["documents"]` cache; persist clamped index if changed.
   - `favIdxRef.current = i; void saveLastFavoriteSlot(i); setActiveDocId(targetId);`
   - `if (resolved?.content) speak(resolved.content, token);`
   - Then `setFavoritesOpen(false); setPickerSlot(null);`.
   - Respects `lockFavorites` the same way the rest of the app does (no special case needed — we're not cycling, just opening).

2. In the row JSX, change the outer `<button onClick={() => setPickerSlot(i)}>` to a `<div>` (or keep it as a button) with two children:
   - A primary clickable area (row content) that calls `openFavoriteSlot(i)` when `doc` exists, or `setPickerSlot(i)` when empty.
   - A right-aligned icon button (`✎` for filled, `+` for empty) that always calls `setPickerSlot(i)` and uses `e.stopPropagation()` so it doesn't also trigger the row open.
   - Keep current styling/spacing; replace the existing `›`/`+` span with the new edit button. Maintain `active:scale` / hover styles.

No DB/schema changes. No changes to the slot picker, swipe logic, or any other slot/menu entry.
