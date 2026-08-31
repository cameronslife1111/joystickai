# Make sentence speech instant (pre-fetch the next sentences)

## How speech works today

When you press the blue/purple arrow or the green orb, the app changes the sentence on screen and then calls one speech function (`speakText`). For a sentence it has never spoken before, that single call does all of this, in order, before you hear anything:

1. Cancels whatever was playing and re-asserts the iPhone audio route.
2. Wakes up (or rebuilds) the audio playback engine.
3. Gets your sign-in token (cached for ~5 min, so usually free).
4. Sends the sentence to the app's own `/api/public/tts` endpoint, which verifies you and forwards it to the hosted Google voice (Gemini 2.5 Flash TTS).
5. The voice model generates audio and streams it back in chunks. The app plays the first chunk the moment it arrives, at 1.15x pace.

Steps 4 and 5 are the delay. Nothing is generated until you land on the sentence, so every new sentence pays a full network round-trip plus the model's own "time to first audio" — typically a few hundred milliseconds to over a second, and worse on cellular. That is the lag you're feeling, and it repeats on every single swipe.

There is already one instant path: the app keeps decoded audio for the last 12 sentences it actually spoke, keyed by sentence text + voice. That is why Repeat is instant and why going back over sentences you just heard is instant. Nothing is ever pre-generated.

## The fix: warm the next sentences before you ask for them

The audio for a sentence is fully deterministic for a given text + voice, so it can be fetched early and stored. The plan is to generate audio slightly ahead of you, in the background, and have the orb press hit the already-warm clip instead of the network.

1. **Add a prefetch queue to the speech engine.** A new call (`prewarmSpeech(text)`) runs the same request as speaking, but instead of playing the audio it only decodes it into the existing replay cache. It never touches the audio route, never cancels playback, and is silently skipped when the sentence is already cached, when Sound is off, or during a hands-free call.
2. **Warm neighbours on every navigation.** When you land on a sentence, the app queues the sentence *after* it and the sentence *before* it (in reading order) for prewarm, one at a time, starting a moment after the current sentence's audio has begun so the live sentence always gets the bandwidth first. Pressing again immediately cancels any prewarm still in flight and the newly-needed sentence takes priority.
3. **Direction awareness for fast readers.** The app tracks whether you're moving forward or backward. Moving forward it warms 2 ahead and 1 behind; backward it mirrors that. Fast repeated presses widen the lookahead slightly in the direction you're travelling — this is the case that makes rapid reading feel instant.
4. **Make the cache big enough to matter and keep it across sessions.** Raise the in-memory clip cache from 12 to a size that holds a comfortable window of sentences, and persist clips (compressed PCM) in the browser's local storage database keyed by sentence text + voice + rate. Re-reading a document you've already been through then costs nothing at all — no network, no credits.
5. **Prefetch is strictly opportunistic.** Any prewarm failure is swallowed; it never shows an error, never marks the audio engine stale, and never blocks a real speak call.

## Cost

Prewarming costs a real generation for a sentence you might not reach. The controls that keep it cheap:

- Only 2 sentences in the likely direction plus 1 behind — not 4-5 in both directions. In normal sequential reading nearly everything warmed is actually heard, so the added spend is small.
- Persistent caching means a sentence is generated **once ever** per voice, instead of every time you pass it. For your usage pattern (reading the same documents repeatedly) this likely *reduces* total spend even with prefetch on.
- Prewarm is off whenever Sound is off, during hands-free calls, and while recording — same gates as speaking.
- A **Prefetch ahead** setting in the existing Sound settings dialog: Off / 1 / 2 sentences, so you can dial the spend yourself.

## Technical notes

- `src/lib/speech.ts`: extract the shared fetch/decode routine out of `speakText`, add `prewarmSpeech` on top of it with its own abort controller and a small serial queue; raise `REPLAY_CACHE_LIMIT`; add IndexedDB persistence for the clip cache with the key `voice + rate + text`.
- `src/routes/_authenticated/app.tsx`: after a navigation resolves the target sentence, call a `warmNeighbours(sentences, index, direction)` helper; wire it to the arrow orbs, keyboard arrows, next-document and repeat paths. Sentence data for the current document is already in the query cache, and neighbouring documents are already prefetched, so no new database reads are needed.
- `src/components/SoundSettingsDialog.tsx` + `user_preferences`: one new small preference for prefetch depth.
- Tests in `tests/speech.test.ts`: prewarm populates the cache without playing, a cached sentence plays with no network call, prewarm never cancels live speech, and prewarm is skipped when sound is off.

## Out of scope

No voice changes, no orb or gesture changes, no visual changes, no change to the 1.15x pace.
