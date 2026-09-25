# Make iPhone sentence speech recover reliably without reloading or jumping backward

## What is actually going wrong

The current recovery combines four behaviors that work against each other:

1. **It tries to revive iPhone speech too early.** The app calls `cancel()` and `resume()` during `pageshow`/`visibilitychange`, outside the next real button press. iPhone may ignore audio activation outside a user gesture.
2. **Every sentence is preceded by another `speechSynthesis.cancel()`.** WebKit confirmed that cancellation callbacks can arrive late and clear the utterance submitted immediately afterward. That exactly matches “the sentence advances, but no sound comes out,” especially after returning from another app and pressing quickly. [WebKit fix](https://github.com/WebKit/WebKit/pull/60457)
3. **The final fallback reloads the whole page.** That is the reload the user sees after pressing purple. It cannot reliably auto-speak afterward because iPhone speech requires a fresh user action, and it creates another opportunity for an older saved reading position to appear.
4. **Two fast purple presses can calculate from the same rendered sentence number.** Both callbacks may choose the same “next” sentence before React paints the first update. The database protection prevents many stale fetches, but it does not make rapid local presses cumulative.

This is consistent with longstanding iPhone/WebKit reports: built-in speech can stop after Safari is backgrounded, start/end events may not fire, and iPhone audio sessions can remain interrupted after returning. [Safari speech report](https://weboutloud.io/bulletin/speech_synthesis_in_safari/) [WebKit interrupted-session report](https://bugs.webkit.org/show_bug.cgi?format=multiple&id=273511)

## Fix

### 1. Move recovery into the first real press after returning

- Backgrounding will stop the current sentence once and mark speech as needing recovery.
- Foreground events will only mark the engine/audio route stale; they will not call `resume()`, repeatedly cancel, speak, or reload.
- The first purple/blue/document-navigation press will synchronously reclaim the mixable iPhone audio mode and resume the built-in speech engine inside that user gesture, then read the requested sentence.

### 2. Stop the cancel-then-speak race

- Do not unconditionally call `cancel()` immediately before every `speak()`.
- Track whether an utterance is truly active or queued.
- When replacement is necessary, detach the old callbacks, cancel once, and start the newest requested sentence only after WebKit has finished clearing the old queue (with a short bounded fallback if it emits no event).
- Keep newest-press-wins behavior, but never allow an old cancel callback or watchdog to erase a newer sentence.
- Treat `onstart`/`onend` as unreliable on iPhone and use request IDs plus bounded timers for cleanup.

### 3. Remove page reload as speech recovery

- Delete the `orby-speech-hard-reset` page-refresh path.
- A speech failure will reset only the iPhone audio session and speech queue, then leave the app on the exact document and sentence.
- If iPhone still rejects a sentence, show the existing speech error and let the next press retry from a clean state; never reload the app or move the reading position.

### 4. Make rapid sentence presses cumulative and immediate

- Add an in-memory current-position reference updated synchronously on every navigation press.
- Purple twice will compute `+1` and then `+1` from that updated reference, even before the screen rerenders.
- Blue, jump, document changes, edits, and server refreshes will keep that reference synchronized.
- Keep optimistic display and background saving; a server response that began before the latest local move cannot overwrite it.

### 5. Harden the iPhone audio-session handoff

- Preserve device-native text-to-speech and the nonexclusive `transient` → `ambient` behavior so music can continue/duck.
- Reassert the shared audio mode on the recovery press and after microphone teardown.
- Ensure a stale recording token cannot block sentence speech after Voice Memos, dictation, screen lock, another Chrome tab, or YouTube.

## Files

- `src/lib/speech.ts` — gesture-time recovery, serialized cancellation, newest-request protection, no reload event
- `src/lib/audio-session.ts` — bounded, safe audio-route reclaim helper
- `src/routes/_authenticated/app.tsx` — remove forced refresh and make rapid navigation use a synchronous position reference
- `src/lib/audio-recorder.ts` — verify recording teardown releases the iPhone session before later speech
- `tests/speech.test.ts` and focused navigation tests — reproduce late cancellation, missing speech events, foreground return, and two rapid presses

## Verification

- Run all speech/recording tests and the app build.
- Add regression coverage proving a delayed cancel callback cannot clear the next utterance.
- Add regression coverage proving two immediate purple presses advance exactly two sentences with no reload or rollback.
- Physical iPhone 16E checks:
  - Focus Remote → another Chrome tab → return → purple speaks on the first press.
  - Repeat after YouTube/music, Voice Memos, screen lock, and app switching.
  - Press purple twice quickly: advance exactly two sentences, hear the newest sentence, no reload.
  - Music continues or ducks; Voice Memo recording is not stopped.

## Scope

No voice, speed, button mapping, visual, database, authentication, or provider changes. Device text-to-speech remains in use.
