## Root cause

In `src/routes/_authenticated/app.tsx`, `commitFullEdit` (the Done / Jump handler in edit mode) saves by:

1. Updating overlapping existing rows in place.
2. Inserting new tail rows with `order_index = existing.length + i`.
3. Deleting surplus.

The `sentences` table has a **unique constraint on `(document_id, order_index)`** (`sentences_doc_order_uidx`). After operations like `insert_sentences_at`, `move_sentence`, AI inserts, and partial deletes, the row order_indexes for a document are not guaranteed to be a contiguous `0..N-1` sequence — gaps and values larger than `existing.length` are common.

So when the user is on the last sentence, adds 3 new ones, and presses Done:

- `existing.length = 12`, but `max(order_index)` may be e.g. `14`.
- Inserting new rows at `order_index = 12, 13, 14` collides with an existing row → unique-violation error.
- The insert is fire-and-forget (`await supabase.from("sentences").insert(newRows)` with no error check, no toast), so the user sees nothing. The toast `"Saved"` still fires from `handleEditDone`, the editor closes, and the sentence count appears stuck — exactly the symptom the user reports.

The same trap exists for the "update in place" path: if existing rows aren't index-aligned to `0..N-1`, updating `existing[i].content` doesn't put it at logical position `i` in the document.

## Fix

Rewrite `commitFullEdit` to fully reconcile the document's sentences in one safe, conflict-free transaction-style flow. The simplest correct shape:

1. Parse `editText` with the existing `parseEditParts` (no change to splitting logic — punctuation + blank-line behavior stays exactly as today).
2. If parts is empty → delete all sentences for the doc, set index to 0, done. (Already works.)
3. Otherwise reconcile against `existing` rows fetched fresh from Supabase (don't rely on the cached `sentences` query, which can be stale mid-edit):
   - **Step A — neutralize unique-constraint collisions:** bump every existing row's `order_index` by a large offset (e.g. `+ 1_000_000`) in a single update. After this no row sits in the `0..N-1` range we're about to write into.
   - **Step B — update overlapping rows:** for `i < min(parts.length, existing.length)`, update the existing row's `content` (if changed) and set `order_index = i`. Always set order_index so the row lands at the right logical position even if it had a gap before.
   - **Step C — insert new tail rows:** for `i ≥ existing.length`, insert `{ user_id, document_id, content, order_index: i }`.
   - **Step D — delete surplus tail rows:** if `parts.length < existing.length`, delete `existing.slice(parts.length)` by id.
4. Check the error on every Supabase call. On any error, surface a real toast (`toast.error("Couldn't save edits")`) and `console.error` the full error so future failures are diagnosable. Do not close the editor on failure.
5. Only after the save succeeds: invalidate `["sentences", activeDocId]`, resolve `targetIdx`, `setIndex(targetIdx)`, close editor, speak the target sentence.

Also fix `handleEditDone` so the `"Saved"` toast only fires after `commitFullEdit` actually succeeds (today it fires synchronously before the awaited save resolves, masking failures). Same for `handleEditJump` and its `"Jumped"` toast.

## Files

- `src/routes/_authenticated/app.tsx` — rewrite `commitFullEdit`, and make `handleEditDone` / `handleEditJump` await the result before toasting success.

No schema changes, no UI changes, no changes to the editor textarea, `parseEditParts`, `splitIntoSentences`, gestures, or any other flow.

## Verification

- Add a sentence at the end of a 12-sentence doc → after Done, doc has 13 sentences in order, last one is the new text.
- Edit the last sentence to contain `"Old text. New 1. New 2. New 3."` → after Done, doc grows to 15 sentences, all split on punctuation.
- Add sentences at the beginning (edit first block, prepend a paragraph) → after Done, new sentences appear at indexes 0..k, rest shifted down.
- Delete sentences from the middle → after Done, count decreases, surviving sentences keep correct content and order.
- Force a failure (e.g. offline) → red error toast appears, editor stays open with text intact.
