## Problem

While the edit view is open, it's still possible for the active document to change under the editor. When the user then presses **Done** or **Jump to**, `commitFullEdit` writes the edited text to whatever `activeDocId` is *right now* — not the doc the user opened the editor on. That overwrites the wrong document with the edited text.

The orb's `onSwipe` already early-returns when `editing` is true, but that isn't enough because:
1. The active doc can also change from non-orb sources (menu, plan advancer opening a doc, realtime doc-open triggered by pin/link updates, etc.).
2. Even the orb-swipe guard depends on the latest `editing` value reaching the gesture callback; a brief mismatch or any stray navigator call can still switch docs mid-edit.

## Fix (two layers, minimal surface)

**1. Lock the active document while editing (source of truth fix).**
- On entering edit mode (`onDoubleTap`), snapshot the current doc id into a new `editOriginDocIdRef`.
- In `commitFullEdit`, use `editOriginDocIdRef.current` as the target instead of the live `activeDocId`. This guarantees "Done"/"Jump to" always save back to the doc the user was editing, even if something else navigated in the background.
- After a successful save, restore focus to that doc (call `setActiveDocId(editOriginDocIdRef.current)` before/after `setIndex`) so the view returns to the doc the edits landed in.

**2. Hard-block all navigation gestures while editing (defense in depth).**
- Keep the existing `if (editing) return;` in the orb `onSwipe` handler.
- Also short-circuit the top of `onSwipeRight`, `onSwipeUp`, `advanceSentence` (and the small handful of other navigation callbacks the orb dispatches to) with `if (editing) return;`, so any programmatic caller — not just the orb — is a no-op while the editor is open.
- Leave `onDoubleTap`, `handleEditDone`, `handleEditJump`, and `cancelEdit` alone (they already check or manage `editing`).

## Files touched

- `src/routes/_authenticated/app.tsx`
  - Add `editOriginDocIdRef` ref alongside `editOriginIdxRef`.
  - Set it in `onDoubleTap` when entering edit mode.
  - In `commitFullEdit`: replace the two uses of `activeDocId` (fetch + RPC + invalidate) with `editOriginDocIdRef.current`; also `setActiveDocId(...)` back to that id on success.
  - Add `if (editing) return;` guards at the top of the navigation callbacks that can change the active doc (swipe-right/up/down handlers and any other doc-navigation entrypoint).

No changes to styles, RPC, DB, or the gesture hook.

## Verification

- Enter edit mode, attempt swipes in every direction on the orb → nothing navigates.
- Enter edit mode, wait for any background trigger (plan advance, notification) → active doc doesn't visibly switch; if it did somehow, pressing Done still writes to the original doc.
- Confirm the fixed doc gets the edits and other docs are untouched.
