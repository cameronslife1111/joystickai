# Fix "no speech at all" on iOS 27 / new macOS

## What I checked

- `src/lib/speech.ts` is now the only path to the speech engine, and every call site (`app.tsx`, `ChatDialog.tsx`, `use-orb-mood.ts`, `__root.tsx`) goes through `speakText` / `cancelSpeech` / `installSpeechUnlock`. So there is exactly one place to fix.
- The current engine does three things that newer WebKit builds are documented to break on:
  1. It **forces `u.voice`** to a voice object picked from `getVoices()`. On iOS 26+/27 an explicitly assigned voice is frequently rejected and the utterance is dropped silently — and it also overrides whatever voice you picked in iPhone Settings.
  2. It **primes with a fake `\u00a0` utterance at volume 0.01**, then `cancel()`s the queue again on the very next `speakText`, so the gesture blessing is consumed by a throwaway utterance.
  3. Its real `speak()` happens after a `cancel()` plus a `setTimeout` retry chain, which breaks the "same task as the user gesture" requirement WebKit now enforces harder.

Reported behavior matches: swipes fire (gestures fixed), speech is completely silent, no errors.

## The fix

### 1. Use the system default voice

Stop assigning `utterance.voice` entirely. Leaving it unset makes WebKit use the device's own default voice — which is exactly the voice you select in iPhone Settings > Accessibility > Spoken Content > Voices. Only set `lang` when the platform gives us a sensible one, and never set `lang` to something that has no installed voice (another silent-drop trigger).

A specific voice is only assigned if you ever explicitly pick one in-app (not part of this change).

### 2. Speak inside the user gesture, synchronously

- `speakText` queues the real utterance immediately, in the same tick as the swipe/tap that requested it — no `setTimeout` before the first `speak()`.
- Only call `cancel()` when something is actually speaking or pending. A no-op `cancel()` on an idle engine is what leaves the WebKit queue in the broken paused state.
- Keep a single, short verification retry (fires only if nothing started and nothing is pending) instead of the current two-stage retry chain, so we never double-speak.

### 3. Replace the fake primer with a real one

Drop the volume-0.01 `\u00a0` primer. Instead, on the first user gesture we simply `resume()` the queue and warm `getVoices()`; the first genuine sentence you trigger becomes the gesture-blessed utterance. This removes the "the primer used up the gesture" failure mode entirely.

### 4. Long-text safety

iOS 26+ silently stops mid-queue on long strings. Split anything over ~200 characters into sentence-sized chunks queued back-to-back, so document sentences and chat replies read all the way through.

### 5. Verify, not guess

Add a temporary in-app diagnostic reachable from the menu (a "🔊 Speech test" row) that reports, in a toast: whether the API exists, how many voices are visible, the resolved default voice name, and whether `onstart` fired. That gives a definite answer from your actual iPhone and MacBook instead of another blind round trip. I'll also drive the app in a headless browser to confirm utterances are queued for each swipe and that no double-speaking occurs.

## Files to change

- `src/lib/speech.ts` — the whole rewrite lands here.
- `src/routes/_authenticated/app.tsx` — add the "🔊 Speech test" menu row only; all existing guards (mute, recording, tokens) unchanged.

## Out of scope

No changes to gestures, what gets spoken or when, mute/recording behavior, or the orb lip-sync animation.
