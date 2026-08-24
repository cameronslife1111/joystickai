# Repair native browser speech without audio routing hacks

## Confirmed diagnosis

- The app already uses the real browser API: `SpeechSynthesisUtterance` and `window.speechSynthesis.speak()` in `src/lib/speech.ts`. It creates no audio element, audio context, hosted voice, or microphone dependency for sentence speech.
- The current wrapper moves replacement speech into `setTimeout(..., 0)`. That takes the actual `speak()` call out of the button’s user-gesture turn, despite the app’s callers explicitly preserving that turn for WebKit. This is the strongest code-supported cause of the new silent Mac behavior.
- WebKit has a confirmed `cancel()` race that could clear a following utterance, but its March 2026 fix specifically protects a new utterance queued after cancellation. The app should use the repaired native behavior rather than permanently delaying every replacement beyond user activation.
- The current app does not select or modify an iOS audio-session category during sentence speech. Therefore the iPhone behavior where native speech interrupts other audio or obeys silent mode is now controlled by that iOS/WebKit build, not by an app-owned audio route.
- Public Web APIs do not provide a cross-browser switch that guarantees all three at once: native system speech, bypassing iPhone silent mode, and ducking rather than interrupting other apps. Setting `navigator.audioSession` to `playback` may bypass silent mode but commonly makes playback exclusive; `ambient` can mix but obeys silent mode. Reintroducing either would recreate one of the reported failures.

## Implementation

1. **Restore gesture-synchronous native speech**
   - Remove the replacement `setTimeout` path.
   - Keep one native utterance per sentence and submit it during the same button activation that selected the sentence.
   - Preserve the generation guard so rapid presses allow only the newest request to remain active.

2. **Use a minimal native queue transition**
   - When replacing speech, detach callbacks from the old utterance, call the browser’s native `cancel()`, and immediately submit the newest utterance.
   - Do not poll, chunk, create silent media, assign an audio-session type, release the microphone, choose a hosted voice, or add device-specific routing.
   - Keep explicit Stop/Mute behavior as immediate cancellation.

3. **Add a narrowly scoped first-gesture initialization only if required**
   - Test the synchronous implementation first.
   - If focused browser verification still shows the first utterance being rejected, initialize the native engine once from the first real user gesture using a short browser utterance, without changing audio routing or running initialization on page load.
   - Do not let initialization cancel or delay the sentence selected by that gesture.

4. **Protect every speech entry point**
   - Verify sentence buttons, document changes, repeat, chat read-aloud, mute, and stop all use the same wrapper.
   - Remove only redundant pre-cancellation that can clear a newly submitted utterance; leave unrelated recording and call code untouched.

5. **Regression coverage and release check**
   - Update focused tests to prove idle and replacement speech are submitted synchronously, rapid presses leave only the newest sentence, stop prevents pending speech, and the speech path creates no media/audio-session/microphone resources.
   - Check build/runtime diagnostics and drive the available browser UI for every six-orb speech action.
   - Device acceptance test after deployment: Mac first utterance and rapid replacement; iPhone speaker and AirPods; silent mode on/off; Apple Music/YouTube already playing.

## Expected outcome and platform boundary

This repairs the app-controlled regression: native speech will remain in the user gesture and work consistently wherever the browser exposes Web Speech correctly. It will not falsely claim to override an iOS beta’s native audio-session policy. If the repaired pure Web Speech call still stops music or respects silent mode on that iPhone build, that final behavior is owned by WebKit/iOS and cannot be made universally duck-and-bypass-silent through the public Web Speech API without switching to generated audio or choosing an incompatible audio-session tradeoff.

## Files

- `src/lib/speech.ts`
- `tests/speech.test.ts`
- Speech call sites only if the audit finds a redundant cancellation immediately surrounding `speakText()`

## Out of scope

No generated or hosted voices, no microphone changes, no audio-session manipulation, no silent audio elements, no gesture remapping, and no visual changes.
