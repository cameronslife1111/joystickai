# Back to free, instant device speech

Sentence reading moves off the paid hosted voice and onto the phone or computer's own built-in speech. No credits, no loading, no network — the sentence starts the moment you press.

## What changes for you

- Every read-aloud (sentence swipes/presses, opening a doc, chat "read replies aloud", repeat) uses the device's built-in voice.
- The Sound popup keeps only the on/off switch. The voice list is gone — it's whatever voice your device is set to (Settings > Accessibility > Spoken Content on iPhone).
- Nothing is pre-generated or cached anymore, so there is no waiting and no stored audio.
- Sound off still means total silence, exactly as today.
- Hands-free calls and voice typing are untouched — those stay on your own OpenAI key.

## iPhone smoothness

iPhone/Safari is strict about built-in speech, so the plan handles its known quirks:

- The very first read after opening the app is armed by your first tap anywhere, so speech is always allowed to start.
- Each new sentence cleanly replaces the one before it (single cancel, then speak), so rapid swiping reads only the newest sentence.
- Coming back from another app, locking the screen, or a phone call resets the speech state so the next press works instead of going silent.
- A read that never actually starts falls back once to a device-default voice pick before showing a short "couldn't start" message.
- If a device genuinely has no built-in speech, the app says so once instead of failing silently.

## Technical notes

- Rewrite `src/lib/speech.ts` around `window.speechSynthesis` + `SpeechSynthesisUtterance`: keep the existing public API (`speakText`, `cancelSpeech`, `isSpeaking`, `setSpeechEnabled`, `setSpeechSuppressed`, `cleanForSpeech`, `handleAppForeground`) so callers don't change. Drop the Supabase token cache, fetch/SSE decoding, AudioContext playback, clip cache, and prewarm.
  - `speakText`: emoji/blank guard, `cancel()`, one utterance, `rate = SPEECH_RATE`, no explicit `voice` (so the system default is used), `onstart/onend/onerror` drive `isSpeaking` and the existing callbacks.
  - Keep `isSpeaking()` accurate via utterance lifecycle so Orby's mouth animation keeps working.
  - Add a one-time gesture primer (`pointerdown`/`touchend`/`keydown`) that resumes a paused synthesizer and warms `getVoices()`; never queue a silent/whitespace utterance.
  - `handleAppForeground` cancels and clears state on `visibilitychange`/`pageshow`/`pagehide`.
  - Retire `prewarmSentences`, `hasCachedClip`, `setSpeechVoice`, `markPlaybackContextStale`, `recoverPlaybackContext` and their call sites.
- Delete `src/lib/speech-clip-store.ts`, `src/lib/tts-voices.ts`, `src/lib/tts-gateway.server.ts`, `src/routes/api/public/tts.ts`.
- `src/components/SoundSettingsDialog.tsx`: remove the voice list, keep the switch.
- `src/routes/_authenticated/app.tsx`: drop the voice preference read/save, the `SoundSettingsDialog` voice props, and the prewarm effect. Leave `user_preferences.tts_voice` / `tts_prefetch` columns in place unused (no migration).
- Check `src/lib/audio-session.ts` / `audio-recorder.ts` usage: keep the iOS mixable-session assert so speech layers over music and mic teardown doesn't steal the route; remove nothing that recording needs.
- Rewrite `tests/speech.test.ts` for the native contract: one utterance per sentence, no network, cancel-then-speak replacement, sound-off silence, suppression during calls, emoji-only rejection, no-support path.

## Out of scope

No changes to swipe mappings, orb layout, chat behaviour, hands-free, voice typing, or the database schema.
