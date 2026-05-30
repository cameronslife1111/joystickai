## Goal

When you open Favorites, tap a slot, and pick a document to fill it, Orby should automatically:
1. Save the slot (unchanged — already works)
2. Close the picker AND the Favorites overlay
3. Switch to the document you just selected
4. Re-trigger the speech function to read that document's current sentence aloud

This removes the two manual steps you do today (closing Favorites, then pressing repeat).

## Where the change lives

`src/routes/_authenticated/app.tsx`, inside the slot picker's `pickDoc` function (around line 1871). Today it only saves favorites and closes the small picker:

```text
pickDoc(docId):
  - build next favorites array
  - saveFavorites(next)
  - closePicker()   // only closes the picker, leaves Favorites grid open
```

## What changes

Update `pickDoc` so that after saving the favorites it also navigates to the picked doc, closes everything, and speaks — mirroring the existing search-overlay `pickDoc` (lines 1977–1998) which already does iOS-safe synchronous speech inside the tap gesture.

New behavior for `pickDoc(docId)`:
1. Build and `saveFavorites(next)` (unchanged).
2. If not muted and `speechSynthesis` is available, synchronously (inside the tap) cancel current speech and speak the picked document's current sentence — read from the cached `["sentences", docId]` query at the doc's `current_sentence_index`, cleaned with `stripEmoji` (same pattern as the search overlay).
3. `setActiveDocId(docId)` so the main view switches to that document.
4. `closePicker()` and `setFavoritesOpen(false)` so both the picker and the Favorites grid close, returning to the sentence view.

The "Clear slot" and "Replace all matching slots" behaviors stay exactly as they are.

## Technical notes

- Speech must be triggered synchronously within the click handler (no awaiting before it) for iOS Safari, so I'll fire the utterance before/independently of the `await saveFavorites`, exactly like the search overlay does.
- If the picked doc's sentences aren't cached yet, speech is skipped gracefully (same as the existing search overlay), but the doc still becomes active so the normal on-load speech/repeat path applies.
- No backend, schema, or other component changes needed.
