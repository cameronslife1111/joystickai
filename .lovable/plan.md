# Repair native sentence speech routing on iOS 27

## Confirmed findings

- The current mouth animation does not follow `speechSynthesis.speaking`; it begins only after the utterance emits a word-boundary event. A moving mouth on the current build therefore means iOS is accepting and processing the sentence, while the audio output itself remains inaudible.
- The app already sets `navigator.audioSession.type = "playback"`, but it does not activate or hold a real playback route while native speech is running. The previous change therefore addressed the desired session category without guaranteeing that iOS 27 actually routes output to the speaker.
- Every swipe currently calls `releaseMic()` at gesture start. When a warm recording context exists, that function starts `AudioContext.close()` without waiting and immediately requests playback mode; the later close completion can race with the speech session and change audio ownership again.
- iPhone Chrome uses WebKit’s speech and audio stack, unlike desktop Chrome. Public WebKit reports confirm recurring silent-switch, microphone-session, and audio-route conflicts, but no public report currently proves a distinct iOS 27 beta SpeechSynthesis regression.

## Fix

1. **Hold an iOS playback route during native speech**
   - Add one reusable, hidden `HTMLAudioElement` containing a local silent audio asset generated in code.
   - Start that element synchronously at swipe start, unmuted, and keep it active only while the native `SpeechSynthesisUtterance` runs.
   - Reassert `navigator.audioSession.type = "playback"` before starting the route anchor and immediately before `speechSynthesis.speak()`.
   - This element will only establish speaker routing; the sentence itself will still be spoken entirely by the iPhone’s built-in speech engine.

2. **Eliminate the microphone teardown race**
   - Make microphone release report when its recording `AudioContext` has actually closed and reassert playback mode after closure.
   - Do not repeatedly close an already-released context on every swipe.
   - If stale microphone resources exist at swipe start, stop their tracks synchronously, establish the playback anchor, and prevent the asynchronous close from reclaiming or resetting the speech route.

3. **Use the safest native voice order**
   - On iPhone, try the implicit system voice first so WebKit can use its valid built-in default.
   - If WebKit reports a real voice error or never begins processing, retry once with a fresh local voice matching the device language, then stop; do not loop through voices indefinitely.
   - Keep desktop Chrome’s currently working voice behavior unchanged.

4. **Tie cleanup to the actual utterance lifecycle**
   - Keep the playback anchor active across all sentence chunks and stop it only on final `end`, terminal `error`, explicit cancellation, page hiding, or replacement by a newer swipe.
   - Preserve newest-swipe-wins queue behavior and avoid same-tick `cancel()` followed by `speak()`.
   - Keep diagnostics limited to route/session state and lifecycle events without storing sentence text.

5. **Verify the exact regression path**
   - Extend tests for playback-anchor activation, playback mode reassertion after microphone closure, implicit-first iPhone voice selection, local-voice error fallback, cancellation cleanup, and unchanged desktop behavior.
   - Verify swipe callbacks still submit the displayed sentence once in every direction.
   - Check the focused speech tests, build diagnostics, and browser runtime errors; final device verification should cover silent switch on/off, speech after dictation, foreground restoration, and disconnected Bluetooth/headphones.

## Files to change

- `src/lib/speech.ts`
- `src/lib/audio-recorder.ts`
- `tests/speech.test.ts`
- `src/lib/audio-session.ts` only if a small lifecycle helper is needed

## Scope

No hosted speech, generated voice audio, new button, gesture remapping, visual redesign, or database change. The iPhone’s native Web Speech API remains the sentence voice.
