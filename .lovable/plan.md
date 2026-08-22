# Rebuild sentence speech as plain browser speech

## Confirmed problem

The current sentence reader is not a basic Web Speech implementation:

- `src/lib/speech.ts` imports both the iOS audio-session helper and the microphone recorder, changes `navigator.audioSession`, and calls `prepareRouteForSpeech()` before speaking.
- It also contains iPhone detection, voice selection and fallback retries, long-text chunking, queue polling, watchdog timers, double cancellation, global gesture listeners, and foreground/page lifecycle handling.
- The Orb gesture layer calls `prepareSpeechGesture` at the start of every gesture, before the swipe action runs.
- The app root installs a global “speech unlock” routine even though it no longer submits an unlock utterance.
- The current build is clean, so this is a behavioral simplification rather than a compilation repair.

That wiring contradicts the intended model: sentence reading should be independent of recording and should call the browser’s native `speechSynthesis` API directly.

## Rebuild

1. **Replace the speech engine with a minimal native wrapper**
   - Keep only text cleanup, API availability checks, `cancelSpeech`, `speakText`, and speaking-state callbacks.
   - For each request: clean the sentence, cancel the current browser utterance, create one `SpeechSynthesisUtterance`, apply the requested rate/pitch, attach lifecycle callbacks, and call `window.speechSynthesis.speak()` directly.
   - Let the browser choose its normal system voice and output route; do not enumerate or assign voices.
   - Keep each displayed sentence as one utterance—no chunk queue, delayed submission, watchdog, retry, or polling loop.

2. **Make speech completely independent of microphone and audio routing**
   - Remove all imports and calls from sentence speech to `audio-recorder.ts` and `audio-session.ts`.
   - Remove `prepareRouteForSpeech` because recording must not expose a speech-specific route hook.
   - Do not create an audio element, request an audio category, inspect audio-session state, stop microphone tracks, or wait for microphone teardown anywhere in the sentence-reading path.
   - Leave actual recording and hands-free voice features intact and separate.

3. **Remove gesture and root-level speech machinery**
   - Remove `prepareSpeechGesture` from the Orb gesture callbacks so gesture start does no audio work.
   - Remove the root `installSpeechUnlock` effect and its global pointer/touch/mouse/keyboard listeners.
   - Keep swipe recognition and sentence navigation unchanged; the resolved sentence still reaches `speakText` synchronously from the existing swipe action.

4. **Preserve the app-facing behavior**
   - A new swipe immediately replaces the previous sentence through the browser’s normal `cancel()` then `speak()` sequence.
   - Mute, chat read-aloud, stop buttons, end/error callbacks, and Orby’s speaking animation continue using the small public speech API.
   - No generated audio, hosted voice, hidden playback, or microphone coordination is introduced.

## Verification

- Rewrite the focused speech tests around the native contract: one utterance per sentence, browser-default voice, immediate cancel-and-speak replacement, callbacks/state, emoji-only rejection, and no audio/microphone/session interaction.
- Remove recorder tests that exist only for speech-route reclamation while retaining microphone recording tests.
- Run the focused speech and recorder tests, check the build/runtime diagnostics, and verify the browser path still receives each swipe-selected sentence.
- Final iPhone check: with music already playing, swipe repeatedly and confirm native browser speech uses the current speaker/AirPods route without any app-created audio or microphone involvement.

## Files

- `src/lib/speech.ts`
- `src/routes/__root.tsx`
- `src/routes/_authenticated/app.tsx`
- `src/lib/audio-recorder.ts`
- `tests/speech.test.ts`
- `tests/audio-recorder.test.ts`

## Out of scope

No changes to swipe mappings, recording behavior, hands-free calls, chat content, sentence navigation, visuals, or backend data.
