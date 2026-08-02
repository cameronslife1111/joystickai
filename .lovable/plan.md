## What's happening

Your position in a list (`current_sentence_index`) lives in the `documents` row, and the app reads it from the cached `documents` query. Two things can refetch that list right when you come back to the app:

- The shared query config in `src/router.tsx` has `refetchOnReconnect: true` (added for the 5G work), and iOS fires a reconnect/online event when the app is foregrounded.
- The running-plans watcher (`src/hooks/use-running-plans-advancer.ts:55`) invalidates `["documents"]` on its poll.

If one of those fetches is already in flight when you swipe, its response lands *after* your swipe's optimistic update and overwrites it with the older index — so the app snaps back one sentence. Because it depends on timing, it only happens sometimes, which matches what you're seeing.

## The fix (small and contained)

1. In `src/routes/_authenticated/app.tsx`, keep a small in-memory record of the last index this device wrote per document (id → { index, writtenAt }), updated inside `setIndex` right where the optimistic cache write already happens.
2. In the `documents` query function, after the rows come back, re-apply any local index that was written after that fetch started. So a stale server response can no longer move you backwards, while genuinely new server data (new docs, titles, positions, plan edits) still comes through untouched.
3. Add `refetchOnReconnect: false` to the `documents` query only (it already has `refetchOnWindowFocus: false`), so foregrounding the app doesn't kick off the competing fetch in the first place. Media/gallery queries keep their reconnect behavior, so the 5G loading fixes stay intact.

Nothing about swipes, speech, saving, or the sentences query changes — writes still persist to the backend exactly as they do today, so switching devices still restores your saved position.

## Technical notes

- Local override entries are cleared once the server value matches, so they can't linger and mask real changes.
- No schema change, no new dependency, no new effect or event listener.
