# Propagate sentence links to identical sentences (slot 18)

When a user links (or unlinks) a document to a sentence, apply the same change to every other sentence in the **same document** whose text is exactly identical.

## Behavior
- Link a doc to a sentence → all sentences in that document with identical content get the same `linked_document_id`.
- Switch the linked doc → all matching sentences are updated to the new value.
- Unlink → all matching sentences are cleared too.
- Scope is limited to the current document only (no cross-document changes).

## Change (`src/components/LinkDocumentDialog.tsx`)

Update `handlePick` so it no longer updates a single row by id. Instead:

1. Fetch the selected sentence's `content` and `document_id`:
   ```ts
   const { data: row } = await supabase
     .from("sentences")
     .select("content, document_id")
     .eq("id", sentenceId)
     .single();
   ```
2. Update every sentence in that document with identical content:
   ```ts
   await supabase
     .from("sentences")
     .update({ linked_document_id: docId })
     .eq("document_id", row.document_id)
     .eq("content", row.content);
   ```
3. Keep the existing toast, `onSaved()`, and dialog close behavior. The `onSaved` callback already invalidates the sentences query so the UI refreshes.

## Notes
- Matching is exact string equality on `content` (same as the sentence text). No trimming/case-folding, so only truly identical sentences are affected.
- RLS already scopes updates to the user's own rows, so no security change is needed.
- No backend/migration changes required.
