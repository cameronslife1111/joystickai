## Goal

Three changes to the orb's red "listening" mode:
1. Transcript is **inserted as a new sentence right after** the current sentence (nothing is replaced/deleted).
2. While glowing red, a **single tap stops** listening and runs the insert (edit mode does not open).
3. Fix the bug where the **beginning of speech is missing** from transcriptions.

## 1. Insert instead of replace

- Add a new server function `insertSentenceAfter` in `src/lib/orby-call-docs.functions.ts` (auth-protected, same shape as the existing `editSentence`): loads the document's sentences ordered by `order_index`, then calls the existing `insert_sentences_at` RPC with `p_insert_at = sentenceIndex + 1` and the transcript as a single sentence. Returns the new index.
- In `src/routes/_authenticated/app.tsx`, rename `dispatchVoiceReplace` → `dispatchVoiceInsert` and call the new function with the snapshotted `{ docId, index }`. Toast becomes "✅ Sentence added", and the view jumps to the newly inserted sentence.
- The transcript is written verbatim (trimmed) as one sentence — no rewriting or splitting.
- `editSentence` stays in place (it's used elsewhere).

## 2. Single tap stops listening

- Gate the orb tap handler: if recording is active, the tap stops recording and dispatches the insert, and does **not** open the document editor. Extract the current stop-and-dispatch block into a shared `stopVoiceAndDispatch()` used by both tap and long-press.
- Long-press still starts recording (and remains a valid way to stop, harmlessly).
- Swipes stay disabled during editing as today; while recording, swipes still work (they no longer affect the target since it's snapshotted).

## 3. Why the first words are lost, and the fix

Cause (in `src/lib/audio-recorder.ts` + the long-press handler): the mic isn't live when the red glow appears. `startPcmRecorder()` is called *after* the 500 ms long-press threshold fires, and it then awaits `getUserMedia` and builds a fresh `AudioContext` — typically several hundred ms more (longer on iOS, where a suspended `AudioContext` must resume before `onaudioprocess` delivers any samples). The UI turns red immediately, so everything spoken during that window is never captured.

Fix, in two parts:

- **Pre-arm the mic:** start acquiring the stream/AudioContext on `pointerdown` (before the long-press threshold) rather than after it, and explicitly `await ctx.resume()` before treating the recorder as live. If the gesture turns out not to be a long press, the recorder is cancelled and torn down.
- **Pre-roll ring buffer:** the recorder keeps capturing into a small rolling buffer (~1.5 s) from the moment it's armed, and `markStart()` (called when the red glow begins) keeps that pre-roll instead of discarding it. Audio spoken slightly before/at the glow is therefore included.
- Keep the existing empty/short-clip guards, but measure them against captured samples rather than wall-clock press duration so a valid short utterance isn't dropped.

## Notes

- Red glow animation, speech-cancel-on-record, and the separate 🔴 dictate button inside the full text editor all stay unchanged.
- Snapshot-at-start targeting is preserved, so navigation while speaking can't move the insert point.
