# Restore reliable speech on current iOS and macOS

## Confirmed findings

- The only `user_preferences` row is currently saved with `muted = true`. In `app.tsx`, every swipe reaches the speech wrapper but exits at the mute guard before `speechSynthesis` is invoked. This alone explains total silence on both devices.
- The speech path also has a WebKit-sensitive cancellation race: each navigation calls `cancelSpeech()` in `claimSpeech()`, then `speakText()` immediately calls `speechSynthesis.cancel()` again before `speak()`. WebKit merged a March 2026 fix for cancellation clearing utterances submitted immediately afterward, so this exact pattern is unsafe on current beta builds.
- The swipe handlers themselves are firing and do call the correct sentence speech path; gesture behavior does not need another rewrite.

## Fix

1. **Restore sound for the current account**
   - Change the persisted sound preference from muted to unmuted so speech is no longer blocked before reaching the engine.
   - Keep the existing Sound on/off menu control and its persistence behavior; add no new UI.

2. **Remove the cancel-then-speak race**
   - Make the shared speech engine the sole owner of queue replacement; `claimSpeech()` will invalidate stale app requests without independently cancelling immediately before every speak.
   - If the synthesizer is idle, submit the utterance synchronously in the swipe event.
   - If speech is already active, cancel once, wait until WebKit reports the old queue idle, then submit the replacement. Do not issue back-to-back `cancel()` calls or `cancel()` followed by same-tick `speak()`.

3. **Make voice resolution deterministic without overriding the device preference**
   - Refresh `getVoices()` when speaking instead of caching a potentially stale voice list.
   - Prefer the voice WebKit marks as the system default, then a local voice matching the page/device language, then the first available local voice. Resolve a fresh voice object for each new utterance.
   - If the voice list is initially empty, listen for `voiceschanged` and retry the pending sentence once; retain the direct default-voice path so speech is not unnecessarily blocked.

4. **Stabilize utterance lifetime and sequencing**
   - Keep strong references to active utterances until `end` or `error`, avoiding WebKit garbage-collection edge cases.
   - Speak chunks one at a time from `onend` rather than queueing the entire batch at once.
   - Record start, end, and error signals in development diagnostics so another silent failure identifies the exact browser state instead of producing another guess.

5. **Verify the real behavior**
   - Add a focused mock synthesis test covering idle speech, replacement while speaking, delayed voice loading, mute gating, stale-request cancellation, and cleanup.
   - Drive real orb swipes in the browser and confirm each direction queues the displayed sentence with no duplicate cancellation.
   - Confirm the existing mute control stops speech and immediately restores it when turned back on, then check the build diagnostics.

## Scope

Only speech behavior and the existing persisted sound preference change. No gesture mapping, visual, chat, document, or new-button changes.
