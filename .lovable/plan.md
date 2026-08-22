# Repair silent device speech on iOS 27

## Confirmed findings

- The current Orby mouth animation starts only after the utterance receives `onstart`, so the reported moving mouth means iOS is accepting the utterance while producing no audible output. This is no longer the earlier “swipe did not call speech” failure.
- iPhone Chrome uses Apple’s WebKit speech and audio stack, not desktop Chrome’s engine. The desktop result therefore does not validate the iPhone path.
- The app currently never sets the page’s iOS audio-session category. Recent WebKit changes in the iOS 27 timeframe specifically modify asynchronous audio-session activation and speech cancellation, and documented iOS cases can report active playback while an ambient or recording-category session remains inaudible.
- The app also calls `speechSynthesis.resume()` in several normal speech paths. A currently working iPhone/iPad speech implementation specifically removed that pattern, while Orby invokes it before speech even when the queue may only be reporting stale paused state.
- The exact iOS 27 audio-session defect cannot be reproduced in the desktop preview, so the diagnosis is an audio-session/routing regression supported by the device symptom and current WebKit changes, not a claim that a specific beta bug has been proven locally.

## Fix

1. **Promote the iPhone page to audible playback mode**
   - Feature-detect `navigator.audioSession` and set its type to `playback` synchronously at swipe start and immediately before submitting device speech.
   - Keep this iPhone/iPad-only and leave unsupported browsers untouched.
   - Reassert playback mode after foreground/page restore because iOS can reset the audio session when Chrome is backgrounded.

2. **Remove the stale resume path on iPhone**
   - Stop calling `speechSynthesis.resume()` as a general warm-up or before every iPhone utterance.
   - If the synth reports a stale paused queue, cancel and rebuild the utterance instead of trying to resume a potentially silent audio session.
   - Preserve the existing desktop behavior unless the shared logic can be simplified without changing working Mac playback.

3. **Reset microphone audio ownership before speech**
   - Ensure any lingering recorder stream or recording `AudioContext` is fully released before a swipe speaks.
   - Switch the iOS audio session from `play-and-record`/ambient state back to `playback` after dictation or hands-free use, so speech is routed through normal media output rather than a stale call/receiver route.

4. **Use a conservative on-device voice fallback**
   - Continue using only `SpeechSynthesisUtterance` and voices returned by the iPhone.
   - On iOS, prefer a local voice matching the device language, then another local voice, before using a browser-marked default that may reference an unavailable enhanced/downloaded voice.
   - If the selected voice errors, retry once with no explicit voice or language; do not add hosted speech, audio files, or UI.

5. **Make the new failure path observable and tested**
   - Record bounded diagnostics for audio-session type/state, selected voice category, `start`, `boundary`, `end`, and errors without recording sentence text or personal data.
   - Treat `onstart` alone as “accepted,” not proof of audible progress; require a boundary/end signal for healthy playback state.
   - Add tests for iOS playback-session promotion, foreground restoration, stale paused-state reset without `resume()`, recorder-to-playback recovery, local-voice fallback, and unchanged desktop speech.
   - Run the focused speech tests and verify build/runtime diagnostics.

## Files to change

- `src/lib/speech.ts`
- `src/lib/audio-recorder.ts` only for restoring playback ownership after microphone release
- `src/lib/use-realtime-voice.ts` only if its cleanup leaves the iOS audio session in recording mode
- `tests/speech.test.ts`

## Scope

No new button, hosted voice service, generated audio, gesture remapping, visual redesign, or database change. The swipe will continue to read the sentence using the iPhone’s built-in speech engine.
