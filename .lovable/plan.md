## Goal

Add a third option to the ↕️ Move sentence popup — **📤 Send to document** — sitting between "🔼 Move up 1" and "🔽 Move down 1". It reuses the existing "Send to which list?" flow (emoji filters, searchable doc list, then top / after current / after a specific sentence) and *moves* the current sentence there: inserted at the chosen spot in the target doc, removed from the current doc, then the site reads the sentence that took its place out loud and normal navigation continues.

## Behavior

1. Tap "📤 Send to document" in the Move sheet → the Move sheet closes and the existing Send-to overlay opens in "move" mode, pre-loaded with the current sentence's text.
2. User picks the target document (same searchable list + emoji filters as New idea).
3. User picks placement: Top of list / After current sentence / After a specific sentence (existing three-stage flow, unchanged).
4. On confirm: the sentence text is inserted into the target document at the chosen index, then the original sentence row is deleted from the source document (remaining sentences compact automatically, as with delete).
5. The reader stays at the same index in the source document, so the sentence that followed the moved one is now current — it is spoken with the normal speak function, in the same user-gesture call so iOS honors it.
6. A toast confirms `Moved to "<title>"`. Everything else (undo-free, caches, counters) behaves like the existing send/delete paths.

## Technical notes

All changes are in `src/routes/_authenticated/app.tsx`; no schema or server changes.

- New state `moveSendSourceId: string | null` (the sentence row id being relocated). Cleared in `cancelCompose` alongside the other send state.
- New handler `openSendSentence()`: guards on `currentSentence`, cancels speech, sets `composeText` to the sentence content, sets `moveSendSourceId`, opens `sendOpen` at stage `"doc"`, closes `moveOpen`. It does **not** set `composing`, so only the Send overlay appears (no New-idea textarea).
- `sendIdea` gets a small branch at the end when `moveSendSourceId` is set:
  - after the successful `insert_sentences_at` RPC, delete the source row (`sentences.delete().eq('id', moveSendSourceId)`) and invalidate the source doc's `["sentences", activeDocId]` query;
  - skip the "point target doc at the new sentence" behavior only if the target is the source doc (in that case the move already lands the reader correctly); otherwise keep it as-is;
  - speak the sentence now occupying `currentIdx` in the source document (clamped to the new last index) instead of the current "spoken" choice, and use the existing toast id with move wording.
  - Same-document sends are supported: insert first, then delete the original, so the RPC's index math is unaffected.
- Insert the new button into the Move sheet's option list as a separate element between the "Move up 1" and "Move down 1" entries (the list is a mapped array, so it is split into two maps or the button is rendered via a special entry in the array with an `action` field). Disabled when there is no current sentence.
- No changes to `insert_sentences_at`, `move_sentence`, or any of the destination-picker UI.
