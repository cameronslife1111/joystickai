## Problem

In `src/routes/_authenticated/app.tsx` (`deleteCurrent`, lines ~715–754), Undo tries a raw `INSERT` at the deleted row's original `order_index`. That collides with the unique `(document_id, order_index)` index whenever the compaction after delete has renumbered sentences, so the catch branch fires and re-inserts the sentence at `max(order_index)+1` — i.e. at the bottom of the document.

The project already has an RPC (`insert_sentences_at`) that compacts and shifts subsequent rows before inserting at a given index — the same one Chat, plan-step, and orby-call use. Undo should use it too instead of hand-rolling an insert.

## Fix

In `src/routes/_authenticated/app.tsx`, replace the Undo handler's insert logic with a single RPC call and simplify the follow-up:

- Call `supabase.rpc("insert_sentences_at", { p_document_id: activeDocId, p_contents: [deleted.content], p_insert_at: deleted.order_index })`.
  - This makes room at the original slot (shifting later sentences down) and inserts the restored sentence there. No collision fallback needed.
- On error, show the existing `toast.error("Couldn't undo delete")` and stop.
- After success, refetch sentences the same way it does now, but locate the restored sentence by content + `order_index === deleted.order_index` (fallback: first row at that index) and call `setIndex(pos)` so the view jumps back to where the sentence used to be.
- Remove the max-order fallback branch entirely — it was the source of the "appears at the bottom" behavior.

No changes to the optimistic delete, the toast UI, RLS, RPC, DB schema, or any other file.

## Verification

- Delete a sentence in the middle of a document → press Undo → the sentence reappears at its original position, later sentences shift back down, and the view lands on that sentence.
- Delete the last sentence → Undo restores it as the last sentence.
- Delete then wait past the toast timeout → no regression; nothing changes.
- Delete + Undo repeatedly on the same sentence → order stays stable.
