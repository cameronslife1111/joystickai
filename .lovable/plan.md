## Two changes to 📚 Next linked doc (Slot 24) in `src/routes/_authenticated/app.tsx`

Both changes live inside `openNextLinkedDocument`. Nothing else touched.

### 1. Update the source doc's sentence index before opening the target

Right now the handler jumps straight to the target document. That leaves the source doc's `current_sentence_index` pointing at whatever the user was on before pressing 📚, so returning to the source lands them on the old sentence.

Fix: after finding `nextIdx` (the sentence in the source doc whose link we're about to follow) and before priming/opening the target, persist `nextIdx` as the source doc's current sentence.

- Optimistically update the docs cache: `qc.setQueryData<Doc[]>(["documents"], prev => prev?.map(d => d.id === root.docId ? { ...d, current_sentence_index: nextIdx } : d) ?? prev)`.
- Fire-and-forget DB write: `void supabase.from("documents").update({ current_sentence_index: nextIdx }).eq("id", root.docId)`.

Result: when the user later navigates back to the source doc (swipe, favorites, jump-to, etc.), it resumes on the sentence that linked out to the doc they were just on.

### 2. Wrap around instead of toasting "no more linked documents"

Replace the current `nextIdx === -1` toast branch with wrap-around logic:

- If no linked sentence exists after `root.fromIndex`, search from the top: `list.findIndex((s, i) => i <= root.fromIndex && !!s.linked_document_id && docs.some(d => d.id === s.linked_document_id))`.
- If that also returns -1, there are literally zero valid linked sentences in the source doc — silently return, no toast.
- Otherwise use that wrapped index as `nextIdx` and continue as normal.

This makes 📚 cycle: last linked doc → first linked doc → second → … with no notification.

### Behavior after the change

- Press 📚 anywhere in the chain → source doc's remembered position updates to the sentence being linked from, then the target opens (icon avatar, speech, prime — all unchanged).
- Reach the end of the source doc's link list → next press loops back to the first linked doc silently.
- All existing edge cases (deleted target skipped, root-clearing on unrelated navigation, cache priming for fast render) remain intact.

### Files touched

- `src/routes/_authenticated/app.tsx` — only inside `openNextLinkedDocument` (lines ~881-956).

No schema changes, no other files.