# Make speech reliable forward/back/green, and keep preloading lean

## What you'll get
- Speech keeps working after the first sentence: forward (purple), back (blue), green button, and right after picking a new voice.
- Preloading covers exactly: the current sentence, the 2 after it and the 2 before it. Nothing else is generated in the background.
- "Speech error" only appears when Gemini really fails, and never for a sentence you've already moved past.

## Likely causes (to confirm first)
The code has a few spots that can each produce "Speech error" after the first play:
1. **Preload requests competing with the live one.** Today every move queues the next 3 sentences plus a sentence for every favorite. That's a burst of Google calls that can hit Google's rate limit, and then the sentence you pressed gets refused.
2. **Asking twice for the same sentence.** If a sentence is still preloading when you press it, a second paid request starts instead of reusing the first one.
3. **Audio player paused and not woken properly.** The player pauses itself 2 seconds after each sentence. On iPhone/Mac, waking it outside your tap can fail, so the next sentence can't play.
4. **Voice change clears nothing.** The new voice has no audio saved yet, so the first press after switching is a fresh call that runs into the problems above.

Step one is reproducing it in the preview and logging the exact Google reply code (for example rate-limited vs. other) so the fix matches the actual cause.

## Changes
1. **Lean preload window**: current, +1, +2, -1, -2. Removed: preloading each favorite's landing sentence and the "+3" sentence. The green button plays its target live (it is only preloaded if it falls inside that window).
2. **Share requests in progress**: pressing a sentence that's still loading joins that same download and plays as the audio arrives. No duplicate charges.
3. **Live sentence goes first**: pressing pauses the preloader until the live sentence has started playing. Preloading then continues one at a time.
4. **One quiet retry only when Google says "busy"** (rate limit or temporary outage), after a short wait and only for the sentence you're on. Any other failure shows "Speech error" straight away. Preloads never retry.
5. **Reliable wake-up**: the player is woken during your tap on every press. If it's stuck, it's replaced. It no longer pauses itself between sentences; it only pauses when you leave the app, so music and YouTube behave as they do now.
6. **Voice change**: stops current audio, clears preloads for the old voice, and preloads the ±2 window in the new voice. The sample "Hi, I'm Kore" is saved so replaying it is free.
7. **No stale errors**: an error from a sentence you've already moved past is ignored.

## Credit guardrails (already in place, kept)
- Sound off or on a call/recording: no requests at all.
- Moving on cancels the old download. The last 80 sentences replay for free.
- Up to 5 sentences are generated per position, and only ones not already saved.

## Technical details
- `src/lib/speech.ts`: `inflight: Map<key, {chunks, listeners, done, promise}>` shared by `speakStreamed` and `runPrewarm`. `pausePrewarm()`/`resumePrewarm()` around the live request. `fetchWithRetry` retries once on 429/503 (live only, honoring Retry-After and capped at 1.5s). Remove `scheduleIdleSuspend` after end. `audioCtx()` recreates when the state is not running after `resume()`, or when it's `interrupted`/`closed`. Guard `emitSpeechError` with `seq === streamSeq`. Export `onVoiceChanged()` → cancelPrewarm.
- `src/routes/api/tts.ts`: pass Google's status through (429/503 kept, not flattened) and log the body briefly.
- `app.tsx` prewarm effect: texts = [cur, +1, +2, -1, -2]. Drop the favorites prefetch-for-voice effect's use in prewarm (the sentence prefetch for the green button's display stays). Rerun on voice change.
- `SoundSettingsDialog`: call `onVoiceChanged` on select.
- Tests: in-flight dedupe, window size = 5, retry once on 429 only, stale-error suppression.
- Verify: Playwright in the preview, going forward, back and forward again, switching voice, then pressing the green button. No "Speech error" and ≤5 `/api/tts` calls per move.
