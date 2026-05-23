## Fix: sentences randomly out of order

### Root cause

Two related bugs let `sentences.order_index` drift away from "display position", which then causes inserts to land in the wrong place:

**Bug 1 — `order_index` becomes sparse after deletes.**
`deleteCurrent` (and AI tool deletes in `plan-step`) remove a row but never compact the remaining rows. A doc with rows `[0,1,2,3,4]` becomes `[0,1,2,3,5]` after deleting the 5th. The UI hides this (it sorts by `order_index` and displays by array position), so the user only sees N items numbered 1..N.

Then a "send to bottom" or "after current" call passes `count` or `current_sentence_index + 1` (a **display position**) into `insert_sentences_at(p_insert_at)`, which treats it as a raw `order_index`. With sparse indexes the math diverges:

- Doc has rows at `order_index [0,1,2,3,5]` (5 visible sentences).
- User sends 2 new sentences "to bottom" → `insertAt = count = 5`.
- RPC shifts rows `>= 5` (the previous "last" row at 5) up by 2 → it lands at `7`.
- New rows are inserted at `5,6`.
- Final order: `[0,1,2,3, NEW1, NEW2, OLD_LAST]`.
- User's previous bottom sentence has now "randomly" moved below the new ones — exactly the symptom reported.

`move_sentence` has the same flaw: `WHERE order_index = v_from` silently no-ops if `v_from` is a display index that doesn't match any actual `order_index`.

**Bug 2 — orphaned rows at `PARK_BASE` (1,000,000+).**
`commitFullEdit` parks every existing row at `PARK_BASE + i` before re-placing them. If any later step fails (network blip, RLS hiccup, page navigation), rows are left stranded at order_index ≥ 1,000,000. A DB scan confirmed this: one doc currently has `max(order_index) = 1,000,012` for 13 rows. Those rows sort to the end forever even though the user never put them there.

### Fix

Establish a single golden rule across every server-side mutation: **operate on display positions, not raw `order_index`, and never leave the column sparse.**

1. **New SQL helper `public.compact_sentence_indexes(p_document_id uuid)`**
   Renumbers every sentence in the doc to `0..n-1` using `ROW_NUMBER() OVER (ORDER BY order_index ASC, created_at ASC)`. Uses the same two-phase negative-bucket trick as the existing RPCs to avoid the unique `(document_id, order_index)` constraint. SECURITY DEFINER, owner check on `documents`.

2. **Patch `public.insert_sentences_at`** — call `compact_sentence_indexes` at the very top, before computing `v_existing` / `v_pos`. After compaction, `p_insert_at` is unambiguously a display position and the existing phase A/B/C logic is already correct.

3. **Patch `public.move_sentence`** — call `compact_sentence_indexes` at the top so `v_from` / `v_to` always match real rows. Existing logic below it is untouched.

4. **New AFTER DELETE trigger on `public.sentences`** — call `compact_sentence_indexes(OLD.document_id)` so deletes (from any path: UI delete, AI tool `mark_*`, future hand-rolled queries, even direct SQL) never leave gaps. The trigger is statement-level over `transition tables` so bulk deletes only compact once per doc.

5. **One-shot cleanup migration** — run `compact_sentence_indexes(...)` for every document that currently has sparse or stranded indexes (`max(order_index) <> count(*) - 1` or `min(order_index) <> 0`). This rescues the doc currently stuck at `order_index = 1,000,012` and any other docs with gaps.

6. **Belt-and-suspenders in `commitFullEdit`** (`src/routes/_authenticated/app.tsx`) — wrap Step A's parking step in a `try`/`catch` that, on failure of any later step (B/C/D), calls `compact_sentence_indexes` to un-park rows. The trigger from #4 already covers the delete path, but this prevents stranded rows on partial network failures.

### Files touched

- `supabase/migrations/<new>.sql` — new helper, patched RPCs, new trigger, one-shot cleanup.
- `src/routes/_authenticated/app.tsx` — `commitFullEdit` recovery path.

No frontend behavior changes. The UI keeps calling the same RPCs with the same arguments; it's the server that now guarantees the invariant.

### Why this fixes it

Every code path that mutates sentence ordering — `insert_sentences_at`, `move_sentence`, any DELETE, and the editor commit — now either operates on compacted indexes or compacts them on the way out. `order_index` becomes a true display position again, so "insert at N" always means "appear at slot N" and no unrelated sentence shifts.