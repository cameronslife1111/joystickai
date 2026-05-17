## Favorites cycle for swipe-right

### Behavior
- Add a **⭐ Favorites list** button to the grid menu.
- Tapping it opens a full-screen Favorites editor with **50 numbered slots** (scrollable grid).
- Tapping a slot opens a document picker (list of all the user's documents). Picking one assigns that document to the slot. Same document may appear in multiple slots. Tapping an already-filled slot lets the user reassign or clear it.
- Empty slots are simply skipped when cycling.
- **Swipe right on the orb** changes meaning:
  - If the favorites array has ≥1 filled slot → advance to the next filled slot (wraps around), set that document as active, jump to its stored `current_sentence_index`, and immediately speak that sentence via Web Speech TTS.
  - If favorites is empty → keep today's behavior (cycle through all documents in `position` order).
- The "current favorite slot" pointer is kept in component state (resets on reload to slot 0); the per-document sentence position is already persisted in `documents.current_sentence_index`, so resuming the exact sentence is automatic.

### Data model
Reuse existing `user_preferences` row — add one column:
- `favorites jsonb not null default '[]'::jsonb` — array of up to 50 entries, each either `null` or a document UUID string. Stored sparsely as `[uuid, null, uuid, uuid, ...]` so slot index is preserved.

No new table needed. On document delete, prune any matching UUIDs from the favorites array (client-side after delete, then upsert prefs).

### UI
- **Menu slot 6 (next empty):** `{ e: "⭐", t: "Favorites", fn: openFavoritesEditor }`.
- **Favorites editor overlay** (same visual language as the existing grid menu):
  - Header: "Favorites" + Close.
  - 50 numbered tiles in a 5-col grid (scrollable). Filled tiles show the document title (truncated); empty tiles show a `+`.
  - Tap tile → inline document picker sheet listing all docs (+ "Clear slot" if filled).
- No toast spam; a single subtle toast when a slot is set/cleared.

### Files to touch
- `supabase/migrations/<new>.sql` — `ALTER TABLE public.user_preferences ADD COLUMN favorites jsonb NOT NULL DEFAULT '[]'::jsonb;`
- `src/routes/_authenticated/app.tsx`:
  - Load `user_preferences` (currently only written, never read) into a `useQuery`.
  - Add `favorites` state synced with prefs; helper `saveFavorites(next)` that upserts.
  - New `FavoritesEditor` component (kept in same file for now to match existing pattern).
  - Rewrite `onSwipeRight` to branch on favorites length; track `favIndex` ref/state; on advance, `setActiveDocId(targetId)` then read fresh sentences and `speak(sentences[doc.current_sentence_index])`. Since `sentences` query keys on `activeDocId`, fetch the target sentence via a one-shot `supabase.from('sentences').select(...).eq('document_id', id).eq('order_index', idx).maybeSingle()` so we can speak without waiting on the query cache.
  - Add ⭐ entry to the `grid` array; menu auto-pads to 15.
  - On document delete, prune `favorites` and persist.

### Out of scope (for this step)
- Reordering favorite slots via drag.
- Persisting `favIndex` across reloads.
- Naming/labeling favorite slots.
- Surfacing favorites anywhere outside swipe-right.
