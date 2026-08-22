# Make swipe speech actually work on iPhone

You're right to be frustrated. Every previous attempt tried to make Apple's built-in browser speech engine (`speechSynthesis`) behave on your iPhone, and each time I could only verify it on desktop. That engine is the problem: on iOS it is allowed to silently refuse — no sound, no error, nothing to debug. I'm going to stop betting on it for your phone.

## What I verified in the code just now

- Swipes do reach the speech path, and the text is submitted in the same touch event (no delay), so the gesture wiring is not the blocker.
- The saved sound preference is on.
- All speech currently goes through the browser's own engine only. There is no audio fallback of any kind, so when iOS declines, there is nothing else to make sound.

I have not been able to observe what your iPhone reports, because that engine reports nothing. So the plan removes the dependency instead of guessing at it again.

## The fix

### 1. Play real audio instead of relying on the browser engine (iPhone path)

- Add a small server function that turns a sentence into spoken audio using the platform's built-in text-to-speech (no API key needed, no new buttons).
- Play it through a single audio player that is "warmed up" on your very first tap of the app. Once an audio player has been started by a real tap on iOS, later plays are allowed — this is the one mechanism iPhones honor reliably, and it's how every podcast/music web app works.
- Newest swipe wins: starting a new sentence stops the previous one instantly.
- Speed: the request starts the moment you swipe, and short sentences begin playing in well under a second. Sentences are cached per-session, so re-reading the same sentence is instant.

### 2. Keep the built-in engine where it already works

- On your MacBook (and any browser where the built-in engine works), nothing changes — it keeps using the free, instant local voice.
- On iPhone/iPad, audio playback becomes the primary path.
- If the built-in engine is tried and produces no sound within a moment, audio playback takes over automatically. So there is no configuration and no way to end up in silence.

### 3. Make failure visible instead of silent

- Add a tiny diagnostics record (kept in the app, no new UI clutter) of what happened for the last few sentences: requested, audio fetched, playing, or blocked with the exact browser reason.
- If it ever goes quiet again, that record tells us exactly which step failed on your device rather than another round of guessing.

### 4. Verify before I hand it back

- Automated tests for: iPhone-style device picks the audio path, desktop keeps the local voice, rapid swipes cancel the previous sentence, and blocked playback falls back correctly.
- Drive the real app in a headless mobile-emulated browser, swipe the orb, and confirm an audio request is made and playback starts for each swipe.
- Report exactly what passed so you can check it on the phone with confidence.

## About the voice

Web pages cannot read the voice you picked in iPhone Settings — Apple does not expose it. The audio path uses a clear, natural-sounding default voice. If you want a different one later, that's a one-line change.

## Files to change

- `src/lib/speech.ts` — routing between local voice and audio playback, cancellation, diagnostics
- `src/lib/tts.functions.ts` (new) — sentence to audio
- `src/routes/__root.tsx` — warm up the audio player on first tap
- `tests/speech.test.ts` — cover the new paths

## Out of scope

No new buttons, no gesture changes, no visual changes, no changes to what text gets spoken or when.
