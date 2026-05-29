## Problem

When you write a "New idea" and tap **Send to…**, the sentences ARE saved to the database correctly (verified against your live data — no rows are lost). But the app shows only one sentence at a time, and after sending you stay parked on your previous sentence. So newly added ideas land out of view (top/bottom/elsewhere) and feel "completely missing." Two secondary bugs make it worse:

1. Inserting above the current position shifts everything down, but `current_sentence_index` is never adjusted — so positions drift.
2. After sending, the target list's sentence count and reading position don't refresh until you fully leave and reopen the document.

## Fix

All changes are in `src/routes/_authenticated/app.tsx`, in the `sendIdea` function (and a small toast/refresh tweak). No database changes — the DB functions already work correctly.

### 1. Jump to the new idea when sending to the document you're viewing
After the insert succeeds, set the active document's `current_sentence_index` to the first inserted sentence (`insertAt`), persist it to the database, update the `documents` cache, and refetch sentences. Result: the moment you send, the screen shows the idea you just wrote — proof it landed.

### 2. Point a different document at the new idea
When sending to a list you're NOT currently viewing, update that document's `current_sentence_index` to `insertAt` in the database and in the `documents` cache, and prime/refetch its `["sentences", targetDocId]` cache. So when you open it later, it opens exactly on the new content instead of an old position.

### 3. Always refresh counts and position live
Make `sendIdea` await an invalidation of both `["sentences", targetDocId]` and `["documents"]` so the header counter (the "X / N") and any list counts update immediately without navigating away.

### 4. Confirm what landed (trust)
After insert, read back the target document's new sentence count and show a clear toast: e.g. `Added 3 to "{title}" — 47 sentences total`. This confirms the save every time.

### 5. Resume on the right sentence
Currently after sending it re-speaks the OLD sentence. Change it so, when sending to the active doc, it speaks/shows the newly inserted sentence (the one at `insertAt`).

## Technical details

- `insertAt` is already computed correctly for all four positions (top / bottom / after current / after a specific sentence). We reuse it as the jump target.
- For the active document: after `supabase.rpc("insert_sentences_at", …)`, call `supabase.from("documents").update({ current_sentence_index: insertAt }).eq("id", targetDocId)`, `qc.setQueryData(["documents"], …)` to reflect it, then `await qc.invalidateQueries(["sentences", targetDocId])` and `["documents"]`.
- For a non-active target: same `current_sentence_index` update + documents cache update; refetch its sentences cache so the next open is correct.
- Toast count: `await supabase.from("sentences").select("id", { count: "exact", head: true }).eq("document_id", targetDocId)`.
- Keep the existing iOS-safe synchronous `speak()` call inside the user gesture; just change which sentence it speaks.
- No changes to `insert_sentences_at` / `compact_sentence_indexes` — they are correct and lossless.

## Verification

After implementing, I'll confirm: (a) sending to the current list jumps the view to the new idea; (b) sending to another list, then opening it, lands on the new idea; (c) the header counter updates immediately; (d) the toast reports the correct new total.
