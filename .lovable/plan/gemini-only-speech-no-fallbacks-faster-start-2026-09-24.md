# Gemini-only speech, no fallbacks, faster start

## What changes for you
- Every sentence is read only by **Gemini 3.8 Flash-Lite**, using your Google key.
- **No backups.** OpenAI voice and the phone's own voice are removed. If Gemini fails, a small "Speech error" message appears and nothing else plays.
- The **High-quality voice** switch is removed from the Sound pop-up (Slot 4). Sound on/off and the 10 voices stay.
- Speech starts noticeably sooner after each press.
- Works the same on iPhone, MacBook, laptops and other browsers.

## How it gets faster
1. **Quicker sign-in check.** Right now every sentence waits for an extra round trip to confirm you're signed in. It will be checked locally on the server instead, which saves time on each press.
2. **No waiting on failed backups.** When Gemini hiccups, the app currently tries OpenAI and then the phone voice before giving up. That chain is removed.
3. **Audio warmed up on your first tap.** The sound player is unlocked the moment you touch the page, so the first sentence doesn't pause while the player wakes up (this also fixes Mac Safari/Chrome starting silent).
4. **Plays the first piece right away.** Tiny audio chunks are scheduled the instant they arrive, with a very small start gap.
5. **Short-phrase hint to Gemini.** The request tells Gemini to read the text as-is, with no extra thinking, so it begins speaking sooner.
6. Existing savings stay: moving to the next sentence cancels the old request, and the last 30 sentences replay instantly for free.

## Kept as is
- Music, YouTube and Voice Memos keep going underneath on iPhone (shared "mix with others" mode). Reading never touches the microphone.
- Your saved voice choice.

## Technical details
- `src/routes/api/tts.ts`: delete `openai()` and the retry branch; hardcode `gemini-3.8-flash-lite-tts`; drop `hq`. Replace `sb.auth.getUser(token)` with local JWT verification via `getClaims` (JWKS cached per isolate). On Gemini non-OK return its status with a short message; abort → 499. Keep the SSE → raw PCM `TransformStream`; flush trailing buffer. Add `thinkingConfig: { thinkingBudget: 0 }` only if the live call accepts it (verify; drop if 400).
- `src/lib/speech.ts`: remove `speakDevice`, `fallbackVoice`, primer/watchdog/`speechSynthesis` code, `highQuality`/`setSpeechHighQuality`. On failure emit `orby-speech-error` with "Speech error" and call `onError`. Create/resume the `AudioContext` on first `pointerdown`/`touchend`/`keydown` and synchronously inside `speakText`; recreate after `interrupted`/`closed` or on return from background. Start offset 0.005s. Cache key drops tier. Fetch the session token from a cached value updated by `onAuthStateChange` instead of awaiting `getSession()` each time.
- `SoundSettingsDialog.tsx` + Slot 4 wiring in `app.tsx`: remove the High-quality switch and related state/prop; stop writing `tts_high_quality` (column left in place, unused).
- `tests/speech.test.ts`: update for no device fallback, error message on failure, cancellation, cache.
- Verify: one live call through `/api/tts` measuring time to first audio byte before/after; build/tests pass; test in the preview on desktop.
