## Goal

Long-press the orb to start recording (red glow), long-press again to stop. Instead of inserting the transcript into the current document, the transcript lands in the **New idea** popup, prefilled and editable, so you can send it wherever you want.

## Changes (all in `src/routes/_authenticated/app.tsx`)

1. **Replace the insert dispatch with a composer handoff**
   - Swap `dispatchVoiceInsert` for `dispatchVoiceToComposer`: transcribe the clip (same `transcribeAudio` server fn, same "Transcribing…" toast), then on success call the existing `openNewIdea()` and set `composeText` to the transcript.
   - If the composer somehow already has text (e.g. a previous dictation), append with `appendTranscript` rather than clobbering it.
   - Toast on empty transcript / failure stays as-is.

2. **Drop the document targeting**
   - Remove `voiceTargetRef` and the `insertSentenceAfter` / `insertAfter` usage from the long-press path, plus the `jumpTo` + sentence-query invalidation that followed it.
   - Remove the "Open a document first" guard — dictation no longer needs an active document.

3. **Keep everything else identical**
   - Recording toggle behaviour, the `micStartingRef` guard, `rec.ready` gating so the red glow only starts once the mic is live, speech cancellation on start, the 400 ms / 4 KB too-short discard, and the block while the editor is open all stay untouched.

## Notes

- `openNewIdea()` currently clears `composeText`; the transcript is applied after it so the popup opens with the text already in place.
- `insertSentenceAfter` in `src/lib/orby-call-docs.functions.ts` becomes unused by this path; it stays in place (harmless, no other behaviour depends on the change).
