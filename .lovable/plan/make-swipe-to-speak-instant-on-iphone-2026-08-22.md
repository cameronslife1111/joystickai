# Make swipe-to-speak instant on iPhone

Goal: the moment a swipe registers, the old sentence stops dead and the new one starts — no fade tail, no warm-up pause. Voices stay exactly as they are.

## Where the remaining delay comes from

Confirmed by reading the code:

- `useOrbGestures` only reports a swipe in `finish()`, i.e. on finger lift. On a phone, the finger travels past the 40px threshold well before it leaves the glass, so every swipe waits for the lift before anything is cancelled or spoken. On a trackpad the lift is nearly simultaneous with the move, which is part of why the Mac feels instant.
- Each utterance submit re-touches the audio layer: `startRouteAnchor()` plus `requestIosPlaybackSession()` run inside `submit()` and again in the iPhone branch of `speakText`, on top of the same pair already run at gesture start. The route is already open by then, so this is repeated per-swipe work in the hot path.
- Every gesture start (`prepareSpeechGesture`) re-asserts the playback session and pokes the anchor even when nothing about the route has changed.
- `submit()` still runs voice resolution and dev logging before handing text to the engine.

The audible fade on cancel is not yet confirmed to be our code — WebKit's speech engine can render a short tail after `cancel()`. That is treated as a diagnosis to verify, not a fact.

## The fix

1. **Fire the swipe as soon as the threshold is crossed.** In the gesture hook, detect the direction during pointer/touch move, dispatch `onSwipe` immediately, and mark the interaction consumed so the later lift does not fire a tap or a second swipe. This removes the finger-lift wait, which is the largest fixed delay on the phone.
2. **Cut duplicate audio-session work out of the speak path.** Keep the route anchor and playback session as a once-per-foreground-session concern: start on first gesture / page show, re-assert only after page hide, visibility change, or microphone use. Remove the per-utterance and per-submit re-assertions so a swipe goes straight from cancel to speak.
3. **Trim the submit path.** On iPhone, skip voice resolution entirely for the normal path (system voice is what we want and is already correct), skip the chunking pass for text under the limit, and drop debug logging from the pre-speak sequence so nothing runs between the swipe and `speak()`.
4. **Attack the fade tail.** Mark the outgoing utterance dead before cancelling, then issue the hard stop and submit the new sentence in the same tick. If a tail is still audible after that, verify whether it is engine-side by testing a stop-then-immediate-stop sequence and by confirming the route anchor is not the thing being heard; whichever the check shows, apply the version that stops audio flat.
5. **Keep the safety net cheap.** Retain the single "utterance never started" watchdog, but make sure it can never re-speak a sentence that a newer swipe has already replaced.

Desktop/Mac behavior is left on its current path throughout.

## Verification

- Focused speech tests updated and run: newest swipe wins, no duplicate speaking, cancel and page-hide still stop audio, a swipe fires once (no tap double-fire) when the threshold is crossed mid-drag.
- Build log and browser runtime errors checked.
- Device check by you: rapid swipes in all four directions on the iPhone should cut off instantly with no tail and start the next sentence with no perceptible pause; taps, long-press recording, and edit mode should behave exactly as before.

## Files to change

- `src/hooks/use-orb-gestures.ts`
- `src/lib/speech.ts`
- `tests/speech.test.ts`

## Out of scope

No voice changes, no new voices or hosted speech, no gesture remapping, no visual changes, no backend changes.
