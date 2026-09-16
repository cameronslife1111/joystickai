# Make device speech duck other audio and recover after app switching

🏆 Let’s make Orby’s device voice request the iPhone’s short-speech audio mode, keep external music or recordings alive whenever iOS permits it, and reliably re-arm speech after returning to Orby.

## Confirmed findings

- Orby already uses the device’s native `speechSynthesis`; no hosted voice or audio file is involved.
- Before each sentence, Orby currently requests `navigator.audioSession.type = "ambient"`. Ambient can mix, but it does not ask iOS to lower other audio while speech runs.
- The web Audio Session API defines `transient` for short sounds that play over other audio and may duck it. `playback` and `transient-solo` are exclusive and must not be used for sentence speech.
- The Audio Session API is experimental and is only a request to iOS. A website cannot guarantee native-style ducking or force simultaneous operation with Voice Memos. The implementation can avoid intentionally interrupting them, but iOS remains the final authority.
- Orby’s own microphone correctly uses `play-and-record`; that path is intentionally allowed to interrupt music. Sentence speech will remain separate from it.
- The current foreground reset retries `speechSynthesis`, but it does not use audio-session state changes and it restores `ambient` rather than re-arming the short-speech category on the next press.

## Go To Format

1. Go to the iPhone audio-session helper and add a dedicated sentence-speech request that tries `transient` first, falls back to `ambient`, and finally leaves the browser on `auto` when neither is accepted.
2. Go to the sentence speech function and request that short-speech session immediately before every `speechSynthesis.speak()` attempt, including watchdog retries and the explicit-device-voice fallback.
3. Go to the utterance finish, error, and cancel paths and restore the normal mixable `ambient`/`auto` session after Orby stops talking, without creating a silent audio element or claiming exclusive playback.
4. Go to the app-return recovery and mark speech stale on `pagehide`, hidden visibility, interrupted audio-session state, and page restoration; clear the dead utterance queue, but wait for the user’s next press before speaking again.
5. Go to the first sentence press after returning and synchronously reassert `transient`, resume and clear the stale speech queue once, then submit a fresh utterance in that same press so iPhone gesture rules are satisfied.
6. Go to the in-app microphone boundary and keep `play-and-record` only while Orby is recording; when recording ends, restore the nonexclusive session. Starting sentence speech may finish Orby’s own held microphone, but it will not access or deliberately interrupt another app’s microphone.
7. Go to the speech and recorder tests and prove that sentence speech never requests `playback` or `transient-solo`, prefers `transient`, restores a mixable mode afterward, survives an interrupted/foreground cycle, and leaves Orby’s recording flow on `play-and-record` until recording ends.
8. Go to the live preview diagnostics and verify the focused tests, build, and browser errors; then perform the physical-iPhone checks below because cross-app audio policy cannot be reproduced in a desktop browser.

## iPhone verification

- Start YouTube Music, return to Orby, and press Speak: music should continue and should duck when that iOS/WebKit version honors `transient`.
- Start a Voice Memos recording, return to Orby, and press Speak: Orby will not request an exclusive session; confirm iOS keeps the recording alive.
- Switch to another audio app and back, then press Speak once: the sentence should play without restarting Orby.
- Start Orby’s red-circle recording: music may stop as requested; stop recording and press Speak to confirm the nonexclusive speech session returns.
- Repeat with the silent switch both ways and with/without AirPods, since `ambient` fallback behavior differs by output route.

## Technical scope

- `src/lib/audio-session.ts`: separate transient speech mode from ambient idle mode; optionally observe supported audio-session state changes.
- `src/lib/speech.ts`: own the short-speech session lifecycle and strengthen gesture-time foreground recovery.
- `src/lib/audio-recorder.ts`: preserve exclusive in-app recording and restore the correct idle mode.
- `tests/speech.test.ts`, `tests/audio-recorder.test.ts`: add session-order, nonexclusive-mode, interruption, and restoration coverage.

## Honest platform limit

This delivers the strongest standards-based behavior available to an iPhone website. Unlike a native iPhone app, Orby cannot set Apple’s private `duckOthers` option or guarantee sharing with Voice Memos. If iOS 27 ignores `transient` for `speechSynthesis`, the safe fallback is mixing with `ambient`; Orby will never reintroduce exclusive playback or a looping silent-audio workaround.

## Out of scope

Voices, speech speed, voice transcription, hands-free calls, visual changes, and hosted text-to-speech.
