## Goal

Orb long-press becomes a dead-simple dictation replace:
1. Long-press → red listening mode (unchanged look/behavior).
2. Long-press again → transcribe with Whisper.
3. Transcribed text **replaces exactly one sentence** — the sentence the user was on at the moment recording started, in the document they were on at that moment.

No AI interpretation, no ops, no web search, no inserts/deletes/moves.

## Changes

**1. Capture the target at record start (`src/routes/_authenticated/app.tsx`)**
- When recording begins, snapshot `{ docId: activeDocId, index: currentIdx }` into a ref.
- If no document is open, don't start recording — show a toast instead.
- Use that snapshot (not live state) when applying the result, so swiping/auto-advance during recording can't retarget the edit.

**2. Replace `dispatchVoiceEdit` with a minimal `dispatchVoiceReplace`**
- Transcribe audio (existing `transcribeAudio` Whisper call, unchanged).
- If the transcript is empty, dismiss quietly.
- Call the existing `editSentence` server function with the snapshotted `documentId` + `sentenceIndex` and the raw transcript as `newText`.
- Invalidate the sentences query, jump the view back to that sentence, and show a short "✅ Sentence replaced" toast. Errors surface as a toast.
- Remove the `voiceEditDocument` import and all the multi-op / focus-index handling.

**3. Retire the heavy voice editor**
- `src/lib/voice-edit.functions.ts` becomes unused; delete it (it holds the JSON-op planner and the Perplexity search path, neither of which is wanted anymore).

## Notes

- Whisper transcription path, recording toggle, red glow animation, and speech-cancel-on-record all stay exactly as they are.
- Transcript is written verbatim (trimmed) — no rewriting or sentence-splitting, so one utterance always yields one sentence.
- The `🔴` dictate button inside the full text editor is separate and untouched.
