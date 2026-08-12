# Add search bar to the chats popup

## Goal
Add a search bar at the top of the full-screen chat threads list so users can quickly find a specific chat thread by name.

## What we will build
- Add a search input field directly under the "Chats" header in the full-screen threads drawer (`src/components/ChatDialog.tsx`).
- Filter the visible thread list in real time as the user types, matching against each thread's `title`.
- Keep the existing "New" button and thread actions (rename, delete) working on the filtered list.
- Clear/reset the search query when the drawer closes so it opens fresh next time.

## Implementation details
- Add local state: `threadSearch` (string) inside `ChatDialog`.
- Place an `<Input>` with a search icon between the header row and the scrolling thread list.
- Use `useMemo` to derive `filteredThreads` from `threads` and `threadSearch`, case-insensitive, trimmed.
- Render the filtered list in place of the current `threads.map` loop.
- Reset `threadSearch` to `""` in the close handler (`setDrawerOpen(false)` path) so the list is unfiltered on next open.
- Preserve the existing `bumpThread` re-sorting behavior: the filtered list still reflects the most recently used threads at the top.

## Files changed
- `src/components/ChatDialog.tsx` — add state, search input, filter memo, and reset logic.

## Out of scope
- Searching inside message content (thread bodies). This is a title-only search to keep it fast and simple.
- Backend changes; no new tables or indexes are needed.
