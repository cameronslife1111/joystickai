# Fix speech on iPhone and gestures + speech on the MacBook

## What I found

**Speech on your iPhone (swipes work, nothing is spoken)**

`speak()` in `src/routes/_authenticated/app.tsx` calls `window.speechSynthesis.cancel()` and then `speak()` in the same tick, and `claimSpeech()` also cancels at the start of every action — so almost every spoken sentence is a cancel immediately followed by a speak.

Newer WebKit has a confirmed bug where cancelling the queue also swallows the *next* utterance you hand it (WebKit PR #60457, and matching iOS 26+ reports). On older iOS this pattern happened to work; on your new build it means the sentence is silently dropped. This is consistent with what you're seeing: gestures fire, screen updates, no audio.

**Mac: no swipes, no speech**

Gestures are pointer-drag only (`src/hooks/use-orb-gestures.ts`: pointerdown → move 38px → pointerup). On a laptop a "swipe" is a two-finger trackpad gesture, which the browser delivers as `wheel` events, never as a pointer drag — so nothing at all happens unless you click-and-drag on the orb with the button held. Speech on the Mac fails for the same cancel-then-speak reason above, plus desktop Safari can start with an empty voice list, in which case `speak()` does nothing until `voiceschanged` fires.

## The fix

### 1. Make speech survive the WebKit cancel bug
Rework the speech layer in `app.tsx` into one small helper:

- Cancel only when something is actually speaking or pending, and then hand the new utterance over on the next tick instead of the same one (short `setTimeout`), still gated by the existing speech token so a newer swipe always wins.
- After handing it over, verify shortly after that `speechSynthesis.speaking || pending` is true; if the engine swallowed it, re-issue once. This is the standard workaround for the WebKit drop and is invisible when it isn't needed.
- Call `resume()` before speaking (Safari can leave the queue paused after a cancel).
- Keep `claimSpeech()` as the cancellation token, but stop having it *and* `speak()` both cancel back-to-back.

### 2. Pick a real voice and wait for the voice list
- Resolve a voice once on load, re-resolving on `voiceschanged`, preferring a local English voice; assign it to each utterance. If the list is still empty, hold the first utterance until voices arrive rather than dropping it.

### 3. Trackpad and keyboard gestures on desktop
In `use-orb-gestures.ts`, add non-touch input paths that map to the exact same four callbacks:

- `wheel` on the orb (two-finger trackpad swipe / scroll): accumulate delta, fire one swipe per gesture with a small cooldown so a single flick doesn't advance five sentences, and pick the dominant axis the same way the pointer path does. Inverted-natural-scroll is handled by treating content-direction consistently with the phone (swipe up = next).
- Arrow keys as a keyboard equivalent (↑ next, ↓ previous, ← menu, → next document), ignored while a dialog or editor is focused, matching the existing spacebar guard.
- Pointer-drag, tap, double-tap and long-press behaviour stay exactly as they are today.

### 4. Verify
- iPhone: swipe up/down repeatedly and confirm each sentence is spoken, then swipe right across documents and confirm the spoken sentence matches what's on screen.
- MacBook: two-finger swipe over the orb in all four directions, arrow keys, plus click-drag; confirm speech on each.

## Files to change

- `src/routes/_authenticated/app.tsx` (speech helper + voice selection)
- `src/hooks/use-orb-gestures.ts` (wheel + arrow-key gestures)

## Out of scope

No change to gesture meanings, the editor, recording/mute guards, or the Orb visuals.
