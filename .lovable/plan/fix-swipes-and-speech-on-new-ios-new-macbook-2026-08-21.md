# Fix swipes and speech on new iOS / new MacBook

## What I checked

- `src/hooks/use-orb-gestures.ts` — all gestures come from Pointer Events bound directly to the orb element, with `setPointerCapture` on pointerdown and a 40px swipe threshold.
- `src/routes/_authenticated/app.tsx` (`speak`, around lines 740-770) — every spoken sentence calls `speechSynthesis.cancel()` and then `speak()` in the same tick, with no voice and no `lang` set.
- `src/routes/__root.tsx` (lines 123-148) — the one-time unlock speaks a single space at `volume = 0`, from capture-phase listeners that remove themselves after the first gesture.
- `src/styles.css` — `.orb` sets `touch-action: none`, `user-select: none`.

I have not confirmed the exact WebKit change in the new OS builds, so the plan hardens both paths against the known-fragile patterns rather than betting on one line. Where WebKit's rules are documented (speech must follow a real user gesture; a cancelled utterance is dropped), the current code sits right on the edge of them.

## The fix

### 1. One shared speech engine

New `src/lib/speech.ts` replacing the ad-hoc `speechSynthesis` calls:

- Unlock with a real (not zero-volume) very short utterance on the first pointer/touch/click, and keep re-arming the unlock listener until the engine has confirmed it actually spoke once, instead of removing it after one attempt.
- Call `speechSynthesis.resume()` before and after every `speak()` — WebKit leaves the queue paused when the gesture chain is broken, which produces exactly "no sound, no error."
- Stop doing `cancel()` immediately followed by `speak()` in the same tick. Cancel, then speak, and if `speechSynthesis.speaking` is still false a moment later, speak once more (the retry is what makes it reliable across WebKit versions).
- Explicitly resolve and assign a voice plus `lang` (waiting for `voiceschanged` once, then caching), since newer Safari can silently drop utterances with no resolvable voice.
- Keep the existing token/mute/recording/call guards so cancellation semantics and "newest swipe wins" stay identical.

### 2. Route all speech through it

`app.tsx`, `ChatDialog.tsx`, and `use-orb-mood.ts` keep their current call sites and behavior, but use the shared engine (`speakText`, `cancelSpeech`, `isSpeaking`) instead of touching `window.speechSynthesis` directly. No changes to what gets spoken or when.

### 3. Make gestures work with a trackpad and any browser

`use-orb-gestures.ts`:

- Attach `pointerdown` to the orb, but track `pointermove` / `pointerup` / `pointercancel` on `window`, so a drag that leaves the small orb still resolves as a swipe — this is the most likely cause of desktop swipes failing, since a trackpad drag travels further than the orb is wide.
- Add a mouse-event fallback (`mousedown`/`mousemove`/`mouseup`) used only when no Pointer Event was seen, and a touch fallback for the same reason, so no browser is left without a path.
- `preventDefault()` on pointerdown/mousedown and set `draggable={false}` on the orb, so native drag/selection can't swallow the gesture.
- Bind through a callback ref instead of the capped `requestAnimationFrame` retry loop, so listeners always land on the live orb node after the editor closes.
- Keep the exact same gesture mapping and thresholds.

### 4. Verify

Drive the real app in a headless browser: synthesize trackpad-style pointer drags in all four directions on the orb, assert the right action fires each time, and assert an utterance is queued for each navigation. Then report what passed.

## Files to change

- `src/lib/speech.ts` (new)
- `src/hooks/use-orb-gestures.ts`
- `src/routes/_authenticated/app.tsx`
- `src/routes/__root.tsx`
- `src/components/ChatDialog.tsx`
- `src/hooks/use-orb-mood.ts`

## Out of scope

No changes to gesture meanings, the editor, recording/Whisper, or the orb's visuals.
