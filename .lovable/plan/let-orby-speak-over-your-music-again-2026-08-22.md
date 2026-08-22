# Let Orby speak over your music again

Right now, opening Orby takes over the phone's audio and kills whatever else is playing. Two pieces of our iPhone speech setup cause that, and both can go.

## What's actually happening

- We create a looping, unmuted silent WAV audio element (the "route anchor") and keep it playing for the whole session. iOS treats that as your app playing media, so it interrupts YouTube Music. This is the "little audio clips" you suspected — it is not speech, it is a silent filler track, and it should not exist.
- We also set `navigator.audioSession.type = "playback"` on every gesture. The `playback` category is exclusive by design: iOS pauses other apps' audio when an app claims it. That is the second interrupter.

Speech itself is already the real browser speech synthesis (`speechSynthesis.speak`) — no audio clips are rendered for sentences. That part stays exactly as is.

## The fix

1. **Delete the silent route anchor entirely.** No looping WAV, no `play()`/`pause()` calls, no anchor start on gesture, unlock, page show, or per-sentence. Nothing of ours plays media anymore.
2. **Stop claiming the exclusive playback category.** Use the mixable category instead of `playback` when we touch `navigator.audioSession` at all, so speech layers over other audio rather than interrupting it. Where the setting isn't needed, don't touch it — the default browser behavior already mixes.
3. **Keep the microphone path correct.** Recording still needs its own category while the mic is live; after recording ends, restore the mixable category (not `playback`) so music resumes instead of staying ducked/stopped.
4. **Leave speed and cancellation alone.** The instant-swipe gesture firing, the same-tick cancel-then-speak replacement, and handler detaching all stay. Removing the anchor should if anything shave work out of the hot path.
5. **Fallback check.** If a build of iOS refuses to speak at all without an exclusive category, the correct trade is to not set any category and rely on the plain speech call — never to reintroduce a silent media loop. If speech goes silent again on your device, that's the knob to revisit, and I'd report it rather than quietly re-adding the anchor.

## Technical notes

- `src/lib/audio-session.ts`: replace the `playback` request with a mixable-category request (`ambient`, falling back to `auto`), keeping the iOS detection and the try/catch.
- `src/lib/speech.ts`: remove `getRouteAnchor`, `startRouteAnchor`, `stopRouteAnchor`, `routeAnchor*` state and all their call sites; `prepareSpeechGesture` becomes a no-op or a bare category assert.
- `src/lib/audio-recorder.ts`: point its post-recording restore at the mixable helper.
- `tests/speech.test.ts` and `tests/audio-recorder.test.ts`: update the assertions that currently expect `playback` and anchor playback; add a test asserting no audio element is created and no other-audio-stopping category is set during speech.

## Verification

- Tests run, build log and runtime errors checked.
- Device check by you: start YouTube Music, then swipe through sentences on the iPhone — music should keep playing while Orby reads, swipes should still cut off and replace instantly, and long-press recording should still work with music resuming afterward.

## Out of scope

Voices, gesture mapping, visuals, backend.
