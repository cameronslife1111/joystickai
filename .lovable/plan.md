## Problem

When you're on sentence 5 of Doc A and tap the "Open link" chip above the orb (or the "Open link" menu action), the linked Doc B opens — but Doc A's saved position gets reset to sentence 1. So when you come back to Doc A, it starts from the top instead of resuming at sentence 5.

## Root cause

In `src/routes/_authenticated/app.tsx`, `openLinkedDocument` (lines 891–901) does:

```ts
setActiveDocId(targetId);
await setIndex(0);
```

`setActiveDocId` is async (React state setter), so when `setIndex(0)` runs immediately after, the `activeDoc` it captures is still **Doc A** (the source). `setIndex` then writes `current_sentence_index = 0` to **Doc A's row in the database** — wiping the position the user was on.

The `setIndex(0)` call was also conceptually wrong: switching to a linked doc should resume that doc at its own saved position, the same way swipe-right cycling between docs already does (see `onSwipeRight`, lines 378–452, which fetches the target doc's `current_sentence_index` and primes the caches before flipping `activeDocId`).

## Fix

Rewrite `openLinkedDocument` to mirror the `onSwipeRight` pattern:

1. Claim a fresh speech token (so any in-flight TTS from Doc A is cancelled).
2. Fetch the linked doc's `current_sentence_index` and its full sentence list in parallel from Supabase.
3. Prime the `["sentences", targetId]` query cache and sync `current_sentence_index` in the `["documents"]` cache (clamping to list length, persisting the clamp if it changed — same safety as the swipe path).
4. Call `setActiveDocId(targetId)`.
5. Speak the resolved sentence with the claimed token.

Critically: **do NOT call `setIndex(...)` anywhere in this function**, because `setIndex` operates on the still-stale `activeDoc` (source doc). Doc A's `current_sentence_index` must never be touched by this action.

## Files touched

- `src/routes/_authenticated/app.tsx` — replace the body of `openLinkedDocument` (lines 891–901) with the swipe-style switch routine; update the deps array to include `claimSpeech`, `speak`, and `qc`.

## Out of scope

- The inline URL chip rendered by `SentenceText` already opens in a new tab via `<a target="_blank">` and never affects sentence position — no change needed there.
- No schema, RLS, or other UI changes.

## Verification

- On Doc A sentence 5 with a linked Doc B: tap the link chip → Doc B opens at its own saved sentence → switch back to Doc A via favorites/swipe → still on sentence 5.
- Same check via the "Open link" grid menu action.
- Linked doc with no prior history opens at sentence 0 (its default).
- Linked doc that was deleted still shows the "Linked document not found" toast.
