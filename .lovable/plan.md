# Sentences getting reordered — root cause + fix

## What I found

After tracing every code path that mutates `sentences.order_index`, exactly **one** path can produce the symptom you're describing (sentences silently swapping order without you using the Move tool, often after the network changes, often around `?`-containing sentences). It's `commitFullEdit` in `src/routes/_authenticated/app.tsx` — the function that runs when you exit the bulk editor (the screen you open by double-tapping the orb).

### Why your three speculations are all pointing at the same bug

`commitFullEdit` saves the doc as **four separate HTTP round-trips**, in this order:

```text
A. UPDATE every existing row → order_index = 1_000_000 + i   (park)
B. UPDATE each reused row    → order_index = its new slot
C. INSERT brand-new rows     → order_index = their new slot
D. DELETE rows that weren't matched (surplus originals)
```

This is not a transaction. If the network flips Wi-Fi → cellular (your #1 speculation) mid-save, any one of those calls can fail while earlier ones already committed. The recovery branch only runs after a confirmed failure return — silently dropped requests on a network handoff don't always surface as errors, so rows can be left:

- still parked at `1_000_000 + i` (appear at the very end of the doc), or
- reused-and-moved without their original siblings being cleaned up (appear twice, in the wrong order), or
- inserted at the new positions while the originals stay parked (looks like the original block moved to the bottom).

That matches what you saw: "Start the car" appearing *after* "I was in the car" — the original "Start the car" row got parked at the high range, and a fresh copy of it landed lower in the order than the rows that didn't need parking.

**Question marks (your #2):** the editor splits sentences on `. ! ?` before saving. If a stored row contains an internal `?` (e.g. `"What about that? Yes."`), opening the editor and closing it — even without typing anything — turns 1 row into 2 parts. That makes the editor *unable* to identity-match (no exact-content row in the existing pool), so it falls back to "delete the original, insert two new rows," which is exactly the path that maximally relies on steps A→D all succeeding. On a flaky network that's the one most likely to half-fail.

**Lists with the Move button (your #3):** I read every call site of `moveSentence`. It is only reachable via Menu → "↕️ Move sentence" → tap a target — there is no gesture or background trigger that can fire it accidentally. It is **not** the source. The same `move_sentence` RPC is also called by the editor's recovery branch with `(0,0)` to compact indexes, but that only runs when the editor save has already failed.

### Other paths I cleared

- `insert_sentences_at` (used by "Send to", "Insert", imports, plan-step `add_sentence`) is a single RPC that compacts → parks → shifts → inserts atomically inside Postgres. It cannot half-apply.
- `move_sentence` is one RPC, atomic.
- `deleteCurrent` is one row delete; the `sentences_compact_after_delete` trigger keeps indexes dense.
- There is no Realtime subscription on `sentences` that writes back, so a stale broadcast cannot reorder rows.

So the only multi-step, non-atomic writer to `sentences` is `commitFullEdit`. Fixing that closes the whole class of bug.

---

## The fix

Make the full-doc save **one atomic RPC** instead of 4 round-trips. The browser sends the new sentence array; Postgres does park → reuse → insert → delete inside a single transaction. Either the whole save succeeds or nothing changes — a mid-save network drop can no longer leave parked rows or duplicates behind.

### Step 1 — New atomic RPC

Add `public.commit_document_edit(p_document_id uuid, p_contents text[])` (SECURITY DEFINER, owner-checked against `auth.uid()`, `EXECUTE` granted to `authenticated` only). Inside one `BEGIN…END`:

1. Compact existing rows to `0..N-1` (reuses the existing `compact_sentence_indexes` helper).
2. Build the identity-preserving diff in SQL using the **same rule the client uses today**: for each new part, claim the unclaimed existing row with matching `content` whose current `order_index` is closest to the new position. Preserves `id` (and therefore `linked_document_id`) on every reused row — same behavior as today, just server-side.
3. Park all rows at negative slots derived from the dense target index (same `-(target+1)` collision-free trick already used by `compact_sentence_indexes` and `insert_sentences_at`).
4. Pull reused rows back to their new positive `order_index`.
5. Insert the brand-new rows at their target positions in one `INSERT … SELECT`.
6. Delete unclaimed originals (now still parked → guaranteed surplus).
7. Final assertion: `count(*) = array_length(p_contents,1)` and every `order_index` is in `0..N-1`; raise to roll the transaction back if either fails.

Because it's one statement, the Wi-Fi↔cellular handoff scenario can only land in two states: pre-call (nothing changed) or post-call (full new state). There is no "stranded parked rows" state.

### Step 2 — Rewrite `commitFullEdit` to call the RPC

Replace the current 4-step block (lines ~797–889) with a single call:

```ts
const { error } = await supabase.rpc("commit_document_edit", {
  p_document_id: activeDocId,
  p_contents: parts,
});
if (error) { toast.error("Couldn't save edits"); return false; }
```

Everything before that (parsing `editText`, computing `parts`, etc.) and after (cache invalidation, jumping to `targetIdx`, re-speaking) stays the same. `recoverFromPark` and the `PARK_BASE` constant get deleted — they only exist to clean up the failure mode the new RPC makes impossible.

### Step 3 — One-shot cleanup for any doc currently left in a bad state

A migration that, for every doc with `order_index >= 1_000_000` OR with a gap in its `order_index` sequence, calls `compact_sentence_indexes(doc_id)`. This rescues any rows still stranded from past half-failed saves so they show up in their content's intended position instead of at the bottom or duplicated.

### Step 4 — Stop unnecessary churn when the editor closes unchanged

Before calling the RPC, compare `parts` to the current ordered content of `existing`. If both arrays are identical (same length, same content in same order), skip the RPC entirely — there is nothing to save. This neutralizes the question-mark scenario specifically: opening the editor on a doc whose stored rows happen to contain internal `?` and closing it without typing will now be a true no-op, not a delete-and-reinsert. It also reduces server load on every "I just wanted to look at it" edit-open.

## Out of scope (intentionally not touching)

- `insert_sentences_at`, `move_sentence`, `compact_sentence_indexes`, the after-delete trigger, plan-step's `add_sentence`, and Send-to — all already atomic.
- Realtime, network-online listeners, retry/queueing layers — not needed once the only non-atomic writer is fixed.
- Editor UX, sentence splitting rules, or anything in `splitIntoSentences`.

## Verification

1. **Question-mark no-op:** open a doc containing `"What about that? Yes."`, double-tap orb to enter editor, immediately tap Done. Row count and IDs unchanged in DB; no toast says "Saved" if we want (optional), order identical.
2. **Network handoff:** Chrome DevTools → Network → set offline mid-save on a 20-row doc. Confirm the doc is either fully unchanged or fully saved — never a mix, never any row with `order_index >= 1_000_000`.
3. **Identity preservation:** edit a doc with a linked sentence; rearrange other rows around it via the editor. The linked sentence keeps its `linked_document_id`.
4. **Cleanup migration:** before/after `SELECT id, order_index FROM sentences WHERE order_index >= 1_000_000` returns zero rows after the migration runs.

Once you approve, I'll switch to build mode and implement these four steps in order.
