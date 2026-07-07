## Goal
Make deleting a sentence a hidden "press the left side of the orb" gesture, remove the triple-tap/triple-click delete, keep right-side press as repeat, and fix the broken Undo.

## Context (current behavior)
In `src/routes/_authenticated/app.tsx`, two invisible buttons flank the orb (lines ~2122-2140):
- **Left of orb** (`right-full`, aria-label "Open pinned document") → calls `openPinnedDocument()`.
- **Right of orb** (`left-full`, aria-label "Repeat sentence") → speaks the current sentence. (Working correctly — leave as-is.)

Delete currently fires from `onTripleTap: deleteCurrent` in the `useOrbGestures` config (line ~1016). Undo lives inside `deleteCurrent`'s toast action (lines ~690-705).

## Changes (all in `src/routes/_authenticated/app.tsx`)

### 1. Move delete to the left orb-press zone
Repurpose the left invisible button (~lines 2123-2131) to trigger delete instead of opening the pinned document:
- Change its `onClick` to call `deleteCurrent()`.
- Change `aria-label` to "Delete sentence".
- Keep it visually invisible (`opacity-0`) and same size/position.

Note: the "open pinned document" tap on that zone goes away. Pinned-document access remains available elsewhere (the menu); if you still want a tap shortcut for it, tell me and I'll relocate it.

### 2. Remove triple-tap / triple-click delete
- In the `useOrbGestures` config (~line 1016) remove `onTripleTap: deleteCurrent` so triple tap no longer deletes (and no longer does anything).

### 3. Fix Undo
Rework the toast's Undo handler (and `deleteCurrent`) so a restore reliably brings the sentence back and shows it:
- `await` the re-insert and check for errors; if the insert fails (e.g. a `(document_id, order_index)` unique-index collision), fall back to appending the sentence at the end (`max(order_index)+1`) so it always comes back.
- After a successful insert, `await qc.invalidateQueries(["sentences", activeDocId])` and refetch, then **navigate the view to the restored sentence** via `setIndex(...)` so the user actually sees it return (the app shows one sentence at a time, so restoring silently in the background currently looks like "nothing happened").
- Surface a small error toast if the restore ultimately fails, instead of failing silently.

## Verification
- Press the left side of the orb → current sentence deletes, "Sentence deleted" toast appears.
- Press Undo → the sentence reappears and the view lands on it.
- Press the right side of the orb → repeats the sentence (unchanged).
- Triple tap / triple click → no longer deletes.
- Single press (menu), double press (edit), and swipes remain unchanged.
