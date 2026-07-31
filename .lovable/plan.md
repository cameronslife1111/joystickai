## Goal

1. Long-press dictation **inserts** the transcribed text right after the current sentence instead of overwriting it.
2. Stop losing the first seconds of speech when the red glow starts.

## Change 1 — Insert instead of replace

**`src/lib/orby-call-docs.functions.ts`** — add a new server function `insertSentenceAfter({ documentId, sentenceIndex, text })`:
- Load the document's sentences ordered by `order_index` (same as `editSentence`).
- Insert the transcript verbatim (trimmed, as a single sentence) at position `min(sentenceIndex, len-1) + 1` using the existing `insert_sentences_at` RPC — the same RPC the "add text" path already uses, so ordering stays consistent.
- Return `{ inserted: true, sentenceIndex: <new index> }`.
- Leave `editSentence` in place (still used elsewhere).

**`src/routes/_authenticated/app.tsx`** — rename `dispatchVoiceReplace` → `dispatchVoiceInsert`:
- Call the new insert function with the snapshotted `{ docId, index }`.
- Invalidate the sentences query, jump to the newly inserted sentence, toast "✅ Sentence added".
- Everything else about the flow (snapshot at record start, toggle behavior, red glow) stays as-is.

## Change 2 — No more clipped beginnings

Root cause: the red glow turns on immediately, but `getUserMedia` + `AudioContext` + the first `onaudioprocess` callback take roughly half a second to a second and a half. The user starts talking at the red glow, before the recorder is actually capturing.

Fix, in order of effect, in `src/routes/_authenticated/app.tsx` and `src/lib/audio-recorder.ts`:

1. **Only glow red once the mic is genuinely live.** Move `setRecording(true)` (and `recordStartMsRef`) to *after* `startPcmRecorder()` resolves. While starting, show a brief neutral "starting mic…" state so the user knows the press registered but hasn't gotten the go signal yet.
2. **Wait for real audio, not just node setup.** `startPcmRecorder` resolves as soon as the graph is wired; add a promise that resolves on the first `onaudioprocess` callback (with a short timeout fallback) and have the recorder expose readiness. The red glow flips on that signal, so the first frames captured are the first frames the user speaks into.
3. **Keep the mic warm between uses.** After the first recording, hold the `MediaStream` + `AudioContext` open (suspended) instead of tearing them down, so a second long-press starts capturing in a few milliseconds instead of a second. Reuse if still live; fall back to a fresh `getUserMedia` if the tracks ended. The stream is released when the user leaves the page.
4. Keep the existing minimum-duration and minimum-blob-size guards so a bumped press still can't send garbage.

## Notes

- No change to Whisper, the transcription server function, the toggle gesture, or the red animation itself.
- No AI interpretation is added back — the transcript is still written verbatim as one sentence.
- The 🔴 dictate button inside the full text editor is untouched, though it benefits from the same warm-mic improvement since it shares `startPcmRecorder`.
