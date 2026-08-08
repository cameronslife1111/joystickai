# Make swipes and speech instant

## What I found in the code

Reading `src/routes/_authenticated/app.tsx` and `src/hooks/use-orb-gestures.ts`, every navigation swipe currently waits on the network before anything happens:

- Swipe up / down (`advanceSentence`, `onSwipeUp`) call `await setIndex(next)` — a database write — and only speak the sentence after that write returns.
- Swipe right (`onSwipeRight`, and the same pattern in `openLinkedDocument` / `openPinnedDocument` / `goToDocument`) awaits two fresh database queries (the target document's saved index plus its full sentence list) before it switches documents, paints the sentence, or speaks.

On a slow/cellular connection those round-trips are exactly the "one or two second" delay. Note: I have not confirmed that the edit-screen change itself introduced this — the awaits predate it — but the tap-to-edit change is a plausible amplifier and I found one related risk (below), so the plan removes the waiting entirely rather than guessing at a single line.

Related risk found while reading the gesture hook: the `retry` safety net added with the edit screen re-renders the whole page on `requestAnimationFrame` whenever the orb element is missing. While the orb is hidden (editor open) this is an unbounded render loop on a very large component, which can leave the page janky right after Done.

## The fix

### 1. Paint and speak first, save in the background
- `setIndex` keeps its optimistic cache update (instant on screen) but the database write becomes fire-and-forget instead of awaited.
- Swipe up / down speak immediately from the already-loaded sentence list — no waiting on the write.

### 2. Swipe right uses cached data instantly, then reconciles
- Resolve the next target document from the already-loaded `documents` cache and, when its sentences are already cached, switch documents and speak right away.
- Fetch the fresh index + sentence list in the background and only correct the view if the result differs, guarded by the existing speech token so a newer swipe always wins.
- If the target's sentences are not cached yet, keep today's fetch-then-show behavior so nothing can display or speak the wrong sentence.

### 3. Prefetch so "not cached yet" is rare
- Extend the existing neighbor-icon warming effect to also prefetch the sentence lists of the next and previous documents in the favorites/all-docs cycle, so swipe right nearly always has data in hand.

### 4. Bound the gesture re-bind retry
- Cap the retry loop (a few attempts, and skip while the editor is open) so it can never re-render the page every frame. Re-binding on exit from the editor still works, since the `rebindKey` already includes the editing state.

## Guarantee that everything keeps working

Unchanged: gesture mapping (up = next, down = previous, left = menu, right = next document, tap = editor, long-press = voice), the display-equals-speech rule (spoken text always comes from the same list the UI renders, by array position), the `localIdxRef` guard against stale refetches, speech token cancellation, mute/recording/editing guards, and the editor save/jump flow.

## Verification

Swipe up/down repeatedly for instant text + speech, swipe right across several favorites and confirm the resumed sentence shown matches the one spoken, enter the editor via single tap, press Done and Jump to top, then re-test all four swipes.

## Files to change

- `src/routes/_authenticated/app.tsx`
- `src/hooks/use-orb-gestures.ts`
