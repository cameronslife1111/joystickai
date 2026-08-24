# Rebuild sentence speech around the native browser engine

## Confirmed findings

- The app already creates a real `SpeechSynthesisUtterance` and submits it to `window.speechSynthesis.speak()`; there are no recorded sentence clips or hosted voices in that path.
- The current wrapper calls `speechSynthesis.cancel()` immediately before every `speak()`. A current WebKit fix specifically addresses this sequence clearing utterances submitted by the following `speak()` call. That accounts for the new silent result on the Mac and makes the present “instant replacement” implementation unsafe on affected Safari/WebKit builds.
- The app still writes `navigator.audioSession.type = "auto"` after recording/call teardown. That API is experimental and WebKit-only, so it cannot be part of a universal speech implementation.
- WebKit itself has documented behavior where `speechSynthesis.speak()` interrupts other media. There is no cross-browser web API that can guarantee both “audible with the iPhone silent switch on” and “only duck other apps.” `playback` bypasses silent mode but is exclusive; `ambient`/WebKit’s current `transient` mapping can mix but respects silent mode. The app must not pretend it can force both.

## Implementation

1. **Replace the unsafe queue transition**
   - Keep a single native utterance per sentence with the browser-default voice.
   - When replacing active speech, detach its callbacks and call `cancel()`, then submit the newest utterance in a separate browser task instead of the same call stack.
   - Guard the deferred submission with a generation token so rapid orb presses speak only the newest sentence.
   - When the engine is idle, call `speak()` synchronously so the normal first press has no added delay.

2. **Remove app-owned iOS speech routing**
   - Delete the `navigator.audioSession` helper and its recorder/realtime teardown calls rather than continuing to assign `auto`, `ambient`, `transient`, or `playback`.
   - Leave microphone recording and hands-free call teardown responsible only for stopping their own tracks and audio elements.
   - Keep all routing decisions for sentence speech inside the browser/operating system.

3. **Preserve controls and lifecycle behavior**
   - Keep the six orb mappings, sentence navigation, mute, chat read-aloud, speed, pitch, and speaking animation unchanged.
   - Explicit stop actions still cancel immediately and invalidate any deferred utterance.
   - Do not add silent audio, `AudioContext`, media elements, selected voices, microphone coordination, or device-specific output code to sentence speech.

4. **Regression coverage**
   - Prove idle speech submits immediately.
   - Prove active replacement never calls `cancel()` and `speak()` in the same task, and only the newest rapid request survives.
   - Prove explicit cancellation prevents a deferred utterance from starting.
   - Prove sentence speech creates no audio element/context and never reads or writes `navigator.audioSession`.
   - Run focused speech/recorder tests and check build/runtime diagnostics.

## Device verification

After deployment, test first on the affected Mac to confirm speech is restored, then on the iPhone with background music and with silent mode enabled. If plain native `speechSynthesis` still pauses music or obeys silent mode, that result is an iOS/WebKit limitation in that OS build—not something a public web app can override consistently without choosing the opposite audio-session tradeoff. Record the exact browser/OS result rather than reintroducing another routing hack.

## Scope

No changes to orb functions, visuals, documents, chat behavior, backend, voices, or microphone features beyond removing the experimental audio-session writes from teardown.
