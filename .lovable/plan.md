## Root cause (first-principles)

The bug isn't in `splitIntoSentences` — that part is fine. The bug is in **how rows are written and read back from the `sentences` table**.

1. **No unique constraint on `(document_id, order_index)` and no tie-breaker on read.** The `sentences` table only has a primary key on `id`. Reads sort by `order_index` only. The moment two rows in the same doc share the same `order_index` (which happens whenever a shift partially fails, or whenever an old insert collided), Postgres returns ties in arbitrary order — so your 5 new sentences appear *scattered* through the list instead of contiguous. This is the "splitting throughout the checklist" symptom.

2. **`sendIdea` shifts the tail row-by-row in N separate awaited round trips** (`src/routes/_authenticated/app.tsx` ~600-613). If any of those updates is delayed, throttled, or interrupted, you get a half-shifted tail — duplicate indices, then ties, then scattered order on next read. The same pattern exists in `appendIdea` (~419-434).

3. **"After current sentence" uses `targetDoc.current_sentence_index` blindly.** When the user is on document A and sends to document B, "current" means "wherever B was last left", which from the user's perspective is unpredictable — so the new sentences land in the middle of B with no way to control it. The user has no UI to pick the actual anchor.

## Fix

### 1. Atomic, gap-free reindex on every insert
Replace the row-by-row tail shift in both `sendIdea` and `appendIdea` with a single deterministic write:
- Fetch the full ordered list of existing rows for the target doc (with secondary sort on `created_at, id` so ties are stable).
- Compute the final array: `[...head, ...newRows, ...tail]`.
- Insert the new rows with their final indices (`insertAt..insertAt+N-1`).
- Issue **one** `upsert` that rewrites `order_index` for every existing row to its new sequential position (`0..total-1`), using `id` as the conflict key. This collapses N round trips into 2 and guarantees contiguous, unique indices even if a previous write left the table in a bad state.

### 2. Add a real uniqueness guarantee in the DB
Migration: add `UNIQUE (document_id, order_index)` on `public.sentences` (after a one-time reindex of existing rows to clean up any pre-existing duplicates). This makes the bug structurally impossible going forward — any future race would error loudly instead of silently scrambling order.

### 3. Stable read order everywhere
Every `.from("sentences").select(...).order("order_index")` in `app.tsx` gets a secondary `.order("created_at", { ascending: true })` tiebreaker, so even legacy data renders in a predictable order while the reindex catches up.

### 4. Let the user pick the anchor sentence when sending "after current"
In the Send-to overlay, after the user taps a target document and chooses "After current sentence":
- Fetch that document's ordered sentences.
- Show a scrollable list with each sentence numbered; the doc's saved `current_sentence_index` is pre-selected and highlighted.
- The user taps the sentence they want the new block to land after (or keeps the default), then confirms.
- `sendIdea` then uses that chosen index instead of the stored one.

"Top" and "Bottom" stay one-tap as today.

### 5. Keep the block together visually
Because step 1 writes the new sentences as a contiguous slice and step 2 enforces uniqueness, when the user opens the target document and scrolls, all 5 sentences appear as a single contiguous run at top / bottom / right after the chosen anchor — which is exactly the behavior the user described as missing.

## Files touched
- `src/routes/_authenticated/app.tsx` — rewrite `sendIdea` and `appendIdea` to use the fetch-then-upsert reindex pattern; add secondary sort to all sentence reads; extend Send-to overlay with the anchor-picker step.
- Supabase migration — one-shot reindex of existing `sentences` rows per document, then `CREATE UNIQUE INDEX sentences_doc_order_uidx ON public.sentences (document_id, order_index);`.

## Out of scope
No changes to web speech, cycling, rename, MP4 export, or the AI prompt. `splitIntoSentences` stays as-is — splitting per sentence is the correct data model; the fix is making the slice land *together*.

## Expected outcome
- Sending 5 sentences to the top / bottom / after-current of any document writes them as one contiguous block.
- Opening that document and scrolling shows all 5 in order, exactly where the user placed them.
- Picking the "after current sentence" option opens a sentence picker so the user is in full control of the anchor.
- Order can no longer drift, on any device, even across retries.
