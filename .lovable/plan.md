## Goal
When Orby edits a document, the result should be saved as properly split sentences right away — no need to open the editor and press Done — and the sentence counts shown when attaching documents in chat should be accurate.

## What's actually wrong (verified)

1. **Orby writes whole paragraphs as one sentence row.** The `add_sentence` handler inserts the text it was given as a single row, and `update_sentence_content` overwrites one row with whatever text it produced. So a multi-sentence answer becomes 1 sentence. Opening the editor and pressing Done runs the app's splitter (`commit_document_edit`), which is why the count only becomes correct after that manual step.

2. **The chat attach picker undercounts sentences.** It loads every sentence row in one request to count them client-side, but that request is capped at 1000 rows. The library currently has 28,721 sentences across 546 documents, so almost every count after the first ~1000 rows is wrong (often 0).

## Changes

### 1. Split on save (Orby's document edits)
Add a sentence splitter to the shared edge-function helpers (same rules the app already uses: `.` `!` `?` terminators with abbreviation handling) and apply it where Orby writes text:
- `add_sentence`: split the content and insert every piece as its own row at the target position, in order. Return the first inserted row plus how many were created.
- `update_sentence_content`: split the new text; the first piece replaces the existing sentence, any remaining pieces are inserted directly after it.
- `move_sentence` reuses `add_sentence`, so it inherits the same behavior.

Result: after any Orby edit, the document already holds one sentence per row and the count is correct immediately.

### 2. Accurate sentence counts
Add a small database function that returns per-document sentence counts for the signed-in user in one grouped query, and have the chat document picker call that instead of pulling every sentence row. This removes the 1000-row ceiling and makes the picker faster.

### 3. Refresh after Orby edits
When a plan finishes, also invalidate the picker's count cache so a chat opened right after an edit shows the new numbers without a reload.

## Technical notes
- New file `supabase/functions/_shared/sentences.ts` (port of `src/lib/sentences.ts`).
- `supabase/functions/plan-step/index.ts`: `add_sentence` passes the split array to `insert_sentences_at_as`; `update_sentence_content` updates the row then inserts the tail at `order_index + 1`.
- Migration: `public.document_sentence_counts()` — security definer, `SET search_path = public`, scoped to `auth.uid()`, returns `(document_id uuid, sentence_count int)`.
- `src/components/DocumentPickerSheet.tsx`: query the RPC; keep the existing sort/filter and UI unchanged.
- Plan completion invalidation lives in `src/hooks/use-running-plans-advancer.ts` (add `documents_with_counts`).

## Out of scope
No changes to the editor UI, gestures, chat layout, or the deletion/consent rules added earlier.
