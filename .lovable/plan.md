# Fix favorites "remembered position" so it survives opening other documents

## The problem

When you swipe right through your favorites list, the app keeps a "bookmark" that tracks which slot you're on (an internal pointer called `favIdxRef`, also saved as `last_favorite_slot`). Swiping right correctly advances this bookmark to the next slot.

The bug: every time the active document changes, a piece of code **snaps the bookmark back to whatever slot the newly-opened document sits in**. So if you're on slot 5 and then open the document that lives in slot 2 (from search, the favorites grid, or "Jump to"), the bookmark jumps back to slot 2. Your next swipe-right then goes to slot 3 instead of continuing forward to slot 6.

In short: opening a document is overwriting your place in the sequence. It should not.

## The desired behavior

- The bookmark (your place in the sequence) should change **only** when you swipe right to advance.
- Opening a document directly — whether it's already in the list at an earlier slot, or not in the list at all — must **not** move the bookmark.
- After opening that document and finishing any linked-document steps, swiping right should continue from where you left off (e.g. you were on slot 5 → next swipe lands on slot 6, not slot 3).
- Linked-document traversal (swipe right opens a linked doc, then the next slot when there are no more links) keeps working exactly as it does today.

## The change

There is exactly one place causing this: an effect in `src/routes/_authenticated/app.tsx` (around lines 431–442) that re-points the bookmark to the active document's slot whenever the active document changes.

We will change it so it **only initializes the bookmark when there isn't a valid one yet** (for example, a fresh session, or the previously-bookmarked slot was emptied / its document was deleted). When the bookmark already points at a valid, filled slot, the effect leaves it alone — so opening any other document no longer disturbs your position.

Concretely:

```text
On active document change:
  - If the current bookmark already points at a valid, filled favorites slot → do nothing.
  - Otherwise (bookmark unset = -1, or its slot is empty / missing) → set the
    bookmark to the opened document's slot (if that document is in the list).
```

This keeps every existing flow intact:
- Normal swipe-right cycling: the swipe handler sets the bookmark, it's valid, the effect no longer touches it.
- You're on slot 5, open slot 2's document, swipe right (after any linked docs) → continues to slot 6. (Fixed)
- Fresh session with no saved position, open a favorited document → bookmark initializes there so the first swipe advances sensibly.
- The bookmarked document gets deleted or its slot cleared → bookmark re-initializes to the current document.

No changes to linked-document handling, the swipe-right advance logic, persistence (`last_favorite_slot`), lock-favorites mode, or the menu/search/jump open flows.

## Verification

1. Set up favorites with documents in several slots (some with linked docs, some without).
2. Swipe right to reach, say, slot 5.
3. Open an earlier document (slot 2) via search / favorites grid / "Jump to".
4. Swipe right through any of that document's linked docs; once links are exhausted, confirm the next swipe lands on **slot 6**, not slot 3.
5. Repeat opening the document A → swipe right should go to C (the slot after where you were), not back to B.
6. Confirm a fresh load still restores your last saved slot, and that linked-doc swiping is unchanged.
7. Test on mobile (touch) and desktop to confirm smooth, consistent behavior.

## Technical detail

- File: `src/routes/_authenticated/app.tsx`, the `useEffect` at ~431–442 keyed on `[favorites, activeDocId, saveLastFavoriteSlot]`.
- New guard: compute whether `favIdxRef.current` is `>= 0`, in range, non-null, and its document still exists in `docs`. If valid, `return` early. Otherwise fall back to the existing `favorites.findIndex(id === activeDocId)` initialization.
- Add `docs` to the dependency array since the validity check reads it.
- No schema or backend changes.
