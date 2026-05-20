## The bug

The link is stored on the sentence row itself (`sentences.linked_document_id`), so the link is supposed to follow the row no matter where it moves. That part works correctly for drag-reorder (`move_sentence` RPC) and for the "add sentence" RPC (`insert_sentences_at`) — both preserve row IDs.

The breakage is in **`commitFullEdit`** in `src/routes/_authenticated/app.tsx` (lines ~636–745), which runs when the user opens the bulk text editor and saves. It rewrites sentences **positionally**:

- `existing[0]` (row id A, maybe linked) → gets new content from `parts[0]`
- `existing[1]` (row id B, linked to docX) → gets new content from `parts[1]`
- …etc.

So if the user inserts two new lines above a linked sentence and saves, row `B`'s id (and its `linked_document_id`) stays at index 1 while the linked text "Walk dog" moves down to a brand-new row at index 3 with no link. The link is now glued to the wrong sentence.

## The fix

Rewrite `commitFullEdit` to do an **identity-preserving diff** instead of a positional overwrite:

```text
Inputs:  existing rows (id, content, order_index, linked_document_id)
         parts[] from the editor textarea

1. Build a content-based pool of existing rows (multimap: content → [ids…]).
2. For each part in order:
     - If an existing row has exact matching content, claim it (preferring the
       closest order_index to the part's new index). Reuse its id, just set
       order_index = i. linked_document_id stays put automatically.
     - Otherwise mark this slot as "new" (insert later).
3. Any existing rows not claimed → deleted.
4. Use the same park-then-place trick already in the file to avoid colliding
   with the unique (document_id, order_index) index while updating.
5. Insert the brand-new parts at their target order_index with no link.
```

The only behavior change is: **unchanged sentence text keeps its row identity**, so its `linked_document_id` rides along to wherever the user moved it in the editor. New text becomes a fresh row (no link, as expected). Edited text (content changed) is treated as new, which also matches user intent — if you rewrite the sentence, the old link to "the recipe for the old sentence" shouldn't silently transfer.

If we later want to also preserve links across rewording (e.g. light edits to a linked sentence), we can add a similarity-match fallback, but that's out of scope here.

## Files touched

- `src/routes/_authenticated/app.tsx` — rewrite the body of `commitFullEdit` (the bulk-edit save path). No DB schema changes, no other call sites affected.

## Out of scope (already correct)

- Drag reorder (`move_sentence` RPC) — preserves row IDs.
- Inserting via the Send-to flow / Plan Mode (`insert_sentences_at` RPC) — shifts other rows' `order_index` without touching their IDs.
- Deleting a sentence — removes one row, links on others untouched.
