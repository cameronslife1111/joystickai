## Goal
Add a button to menu **slot 15** (currently empty) that marks the user's current sentence for deletion by prepending a 🗑️ emoji to that one sentence — purely a visual cue, no actual deletion.

## Current state
- The menu grid lives in `src/routes/_authenticated/app.tsx`.
- Slot 15 maps to `filled[14]`, which is currently `null` (was folded into Chat).
- The active sentence is available as `currentSentence` (with `currentIdx` / `activeDocId`).
- Sentence text lives in the `sentences` table; updates go through `supabase.from("sentences").update(...)`.

## Changes (all in `src/routes/_authenticated/app.tsx`)

1. **New callback `markCurrentTrash`**
   - Reads `currentSentence`. If none, no-op (optionally a small toast).
   - If the content does NOT already start with `🗑️`, prepend `🗑️ ` to the content.
   - Persist: `await supabase.from("sentences").update({ content: newContent }).eq("id", currentSentence.id)`.
   - Invalidate the sentences query (`qc.invalidateQueries({ queryKey: ["sentences", activeDocId] })` matching existing usage) so the UI refreshes.
   - Close the menu (`setMenuOpen(false)`), and show a confirmation toast like `Marked for deletion`.
   - Idempotent: pressing again won't stack multiple trash cans.

2. **Add a grid entry** for the new button, e.g. `{ e: "🗑️", t: "Mark trash", fn: () => void markCurrentTrash() }`.

3. **Wire slot 15**: change `filled[14] = null;` to point at the new grid entry, with the comment updated to `15 Mark with trash`.

## Notes
- This only edits that one current sentence — no other sentences, documents, or plans are touched.
- It does not delete anything; it only adds the emoji as a visual marker the user can act on later.
- This is distinct from the existing `pending_delete` flag / `mark_delete` voice flow — per the request it just adds the 🗑️ character to the sentence text.
