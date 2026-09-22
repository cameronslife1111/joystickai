# Make iPhone sentence speech duck instead of stopping other audio

Orby will keep using the iPhone’s own voice at the current speed. Sentence reading will request iOS’s nonexclusive short-speech mode, recover cleanly after app switching, and stay completely separate from every microphone path.

## Confirmed findings

- Sentence reading already uses the device’s `speechSynthesis`; it does not download or play generated voice files.
- The current speech path forces `ambient` before speaking. That mixes, but does not ask iOS to duck music.
- It also repeatedly resumes and cancels the speech engine, including delayed resets after returning from another app. Those delayed cancellations can erase a newer sentence and make speech appear to stop randomly.
- Orby’s recording code uses `play-and-record`, stops its microphone tracks when recording ends, and returns the page to `ambient`.
- iOS defines `transient` for short prompts that can play over and duck other audio. `playback` and `transient-solo` are exclusive and must never be used for sentence reading.

## Go To Format

1. Go to the iPhone audio controls and add a sentence-speech mode that tries `transient` first, falls back only to `ambient`, and never requests `playback`, `transient-solo`, or `auto`.
2. Go to sentence reading and request that short-speech mode immediately before each device utterance, including the one permitted fallback attempt.
3. Go to sentence completion, error, mute, and stop paths and return the page to `ambient` after speech ends.
4. Go to app-switch recovery and remove the delayed resume/cancel loop. Clear an interrupted utterance once, refresh the device voice list, and wait for the next user press before speaking again.
5. Go to the next sentence press and use one cancel followed by one fresh utterance in the same gesture. If iOS silently swallows it, retry once with a local device voice, then show the existing short error.
6. Go to all sentence-speech paths and keep them microphone-free. Reading will never open, stop, release, or warm a microphone, so it does not deliberately interfere with Voice Memos.
7. Go to Orby’s own voice recording boundaries and keep `play-and-record` only while Orby is recording; fully stop tracks and restore `ambient` immediately afterward.
8. Go to the focused tests and verify short-speech-first ordering, ambient restoration, no exclusive categories, no microphone or audio-element access, interruption recovery, one-retry behavior, and unchanged speech speed.
9. Go to the preview diagnostics and confirm tests and the app are clean, then verify cross-app behavior on the physical iPhone because desktop browsers cannot reproduce iOS audio focus.

## iPhone checks

- Play YouTube Music, return to Orby, and read several sentences: music should continue and should duck when iOS honors `transient`.
- Start a Voice Memo, return to Orby, and read sentences: Orby will not touch the microphone; confirm the memo stays recording.
- Switch to another app and back, then read once: speech should work without restarting Orby.
- Record inside Orby, stop, then immediately read a sentence.
- Repeat with AirPods and with the ring switch in both positions.

## Platform limit

This is the strongest standards-based setup available to an iPhone website. `transient` asks iOS to duck other audio, but Apple still makes the final audio-focus decision. If iOS 27 ignores `transient`, Orby falls back to simultaneous `ambient` mixing rather than stopping music. The app will not reintroduce exclusive playback, a silent looping audio file, or hosted speech.

## Scope

Speech speed, voices, gestures, visuals, voice typing, hands-free calls, and backend behavior stay unchanged.
