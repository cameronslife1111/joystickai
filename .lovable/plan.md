## Goal
Turn the currently-empty grid slot **14** into a **🕘 Recent docs** button that opens a pop-up (styled like the existing 🔍 Search docs pop-up) listing the documents the user has most recently opened, newest first. Tapping one opens it, just like the search results.

## How "recent" is tracked
There is no backend column for last-opened, and adding one would touch business/data logic. To keep this a frontend-only change, recency is tracked client-side in `localStorage`:

- A small ordered list of recently-opened document IDs (most-recent first, capped at ~15), keyed per nothing fancy (single key, e.g. `orby-recent-docs`).
- A `useEffect` watching `activeDocId` pushes the current doc to the front of that list whenever it changes. This captures every way a doc gets opened (search, favorites, swipe, pinned, etc.) because they all flow through `setActiveDocId`.
- The list is kept in React state (initialized from `localStorage`) so the pop-up re-renders as it updates.

## What gets added (all in `src/routes/_authenticated/app.tsx`)

1. **State + persistence**
   - `recentOpen` boolean state for the pop-up.
   - `recentIds` string[] state, initialized from `localStorage`.
   - A `useEffect([activeDocId])` that, when `activeDocId` is set, moves it to the front of `recentIds`, dedupes, caps the length, and writes back to `localStorage`.

2. **Slot wiring**
   - Add a new menu entry `{ e: "🕘", t: "Recent docs", fn: () => { setMenuOpen(false); setRecentOpen(true); } }` to the `grid` array.
   - In the `slots` useMemo, set `filled[13] = grid[<newIndex>];` (slot 14) instead of `null`.

3. **Recent-docs pop-up**
   - Rendered with `{recentOpen && (() => { ... })()}`, mirroring the Search-docs overlay markup (same overlay container, card, header with a Close button, scrollable list).
   - Builds its list by mapping `recentIds` to the matching `Doc` from `docs` (skipping any that no longer exist), preserving recency order — no alphabetical sort.
   - Reuses the same `pickDoc` behavior as search (respects `lockFavorites`, speaks the current sentence when unmuted, calls `setActiveDocId`, closes the pop-up).
   - Shows an empty-state message ("No recent documents yet") when the list is empty.
   - No emoji-filter row and no text input (it's a recency list, not a search) — title reads `🕘 Recent docs`.

4. **Outside-tap handling**
   - Add `recentOpen` to the existing `searchOpen || ...` interaction-guard condition (around line 515) so background gestures are suppressed while it's open, consistent with the other overlays.

## Out of scope
No database, schema, or server changes. No change to how documents are opened — only an additive recency tracker plus the new slot button and pop-up.