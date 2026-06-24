## What's happening

The current sentence position (`current_sentence_index`) is stored in the React Query cache for the `documents` query in `src/routes/_authenticated/app.tsx`. When you swipe, the code optimistically updates that cache and writes the new index to the database.

React Query's default `refetchOnWindowFocus` is **on**. When you leave Orby and come back, the browser fires a "focus" event that triggers an automatic background refetch of the `documents` query. If you swipe in that same instant:

1. Your swipe optimistically sets the new index and saves it.
2. The focus-triggered refetch (started a moment earlier) finishes and **overwrites the cache with the older server value** — so the screen snaps back to the previous sentence.
3. The speech still reads the sentence you swiped to, which is why it sounds half-working before settling.

This is a classic refetch-on-focus race condition. It only shows up right after returning to the app because that's the only time a focus refetch is in flight.

## The fix

Disable `refetchOnWindowFocus` for the two queries that drive the visible sentence, so returning to the app never kicks off a background refetch that can clobber an in-flight swipe:

- The `documents` query (`~line 244`) — holds `current_sentence_index`.
- The `sentences` query (`~line 279`) — holds the sentence list.

Add `refetchOnWindowFocus: false` to each.

### Why this is safe for save/load

- The in-memory cache already holds the latest values while the app stays mounted (leaving to another app does not unmount Orby), so nothing is lost by skipping the focus refetch.
- Saving still works exactly as before: every swipe/move still writes to the database and updates the cache optimistically.
- Loading still works: on a genuine fresh load/mount the queries fetch normally, and `refetchOnReconnect` (for network drops) stays enabled.

### File changed
- `src/routes/_authenticated/app.tsx` — add `refetchOnWindowFocus: false` to the `documents` and `sentences` `useQuery` configs.