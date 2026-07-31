## 1. Microphone stays on after recording stops

Cause (verified in `src/lib/audio-recorder.ts`): the recorder deliberately keeps the `MediaStream` + `AudioContext` "warm" between recordings (`warm` cache) so the mic doesn't cold-start and clip speech. Stopping a recording only detaches the processor node — the mic track stays `live`, so iOS keeps the orange mic indicator on indefinitely.

Fix: fully release the mic when a recording ends.
- Call `releaseMic()` after `rec.stop()` / `rec.cancel()` in:
  - the orb long-press toggle in `src/routes/_authenticated/app.tsx` (both the stop path and the error path)
  - `src/lib/use-voice-dictation.ts` (stop path, error path, and `cancel`)
- Clip protection stays intact because startup still awaits the recorder's `ready` promise (red glow only appears once real audio frames arrive), so re-acquiring the mic on the next press costs a moment of setup but no lost words.

## 2. Move the New Idea 🔴 button to a floating button

In the composer action row, remove the dictation button and instead render a fixed-position button mirroring the editor one: `fixed right-[4vw]`, `bottom: 60svh`, `z-50`, same pill styling, rendered when `composing` is true. It keeps `onPointerDown` preventDefault/stopPropagation so the keyboard and textarea focus aren't disturbed, and still calls `composeDictation.toggle()`. Result: Cancel / Send to… / Add to current stay in the row; the mic floats above the keyboard.

## 3. New "Add to current" button in the New Idea popup

Add a third pill in the composer row (between Cancel and Send to…), enabled only when there's text:
- splits `composeText` with the existing `splitIntoSentences`
- inserts right after the current sentence of the currently-open document via the existing `sendIdea(activeDocId, "current")` path — the same RPC-based insertion used everywhere else, no reordering logic
- closes the composer, refreshes the sentence/document caches, and speaks the first inserted sentence (existing `sendIdea` behavior)
- disabled when there is no active document

## Technical notes
- Files touched: `src/routes/_authenticated/app.tsx`, `src/lib/use-voice-dictation.ts`.
- No schema or server-function changes; `insert_sentences_at` and `editSentence` are untouched.
- `sendIdea` is reused verbatim for "Add to current" so the sensitive insert-index logic isn't duplicated.
