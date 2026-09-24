# Streamed Gemini voices with 10-voice picker on Slot 4

## What you get
- Every sentence you land on is read by **Gemini 3.8 Flash-Lite** voice, using your own Google key.
- An optional **High-quality voice** switch uses **Gemini 3.8 Flash** for richer reading.
- If Gemini fails, Orby automatically retries that one sentence with **OpenAI gpt-4o-mini-tts** (your existing OpenAI key). If both fail, the phone's own voice reads it, so reading never goes silent.
- **Slot 4** opens a Sound pop-up: sound on/off, High-quality switch, and **10 voices** (each plays a short sample when tapped): Charon, Fenrir, Puck, Orus, Iapetus (lower) and Kore, Aoede, Leda, Zephyr, Autonoe (higher). Your choice is saved to your account.
- Speed stays brisk, like now.

## Saving money
- Moving to the next sentence cancels the previous request right away, so you only pay for audio you actually hear.
- The last ~30 sentences are remembered on the device, so Repeat and going back replay free.
- Audio starts playing as the first piece arrives instead of waiting for the full clip.
- Reading is capped to the selected sentence (or paragraph in chat read-aloud) — never a whole document by default. Nothing is generated ahead of time.

## Music, YouTube and Voice Memos keep going (iPhone 16e, iOS 27)
- Orby plays speech in the iPhone's shared "mix with others" mode, so YouTube/music keep playing and a Voice Memo keeps recording while Orby talks. As you agreed, Orby is silent when your side switch is on silent.
- Reading aloud never touches the microphone. Orby only claims the microphone during its own recordings and releases it the moment they end.
- After switching apps, the next press rebuilds the audio player fresh, so you never have to restart the app.
- Mac and laptop browsers mix audio normally, so nothing else is paused there.

## What I'll need from you
- Your **Google AI Studio key** (a secure form will pop up). Everything bills to your Google account.

## Checks
- Real test request for each engine and one sample per voice.
- Rapid next/previous presses: no overlap, old audio stops instantly.
- On your iPhone: play YouTube Music and read; start a Voice Memo and read; record in Orby then read; switch apps and come back; repeat with AirPods. Also check on your MacBook.

## Technical details
- Secret `GOOGLE_API_KEY` (user's own; direct Google Generative Language API, streaming `streamGenerateContent?alt=sse`, `responseModalities: ["AUDIO"]`, `prebuiltVoiceConfig`, 24 kHz PCM). Model ids `gemini-3.8-flash-lite-tts` / `gemini-3.8-flash-tts` confirmed with a live call before wiring; if Google names them differently, use Google's exact ids.
- Fallback: OpenAI `/v1/audio/speech` `gpt-4o-mini-tts`, `response_format: "pcm"`, streamed, with a voice mapped from the chosen one. Only 429/5xx trigger fallback retry; 400/401/403 surface a toast and drop to device voice.
- New authenticated server route `src/routes/api/tts.ts` validates the user, streams PCM through unbuffered, forwards `request.signal` for cancellation (499 on abort). No artificial timeouts.
- Client `src/lib/speech.ts` rewritten as a streaming controller: one shared `AudioContext` created/resumed in the tap gesture, PCM chunks scheduled as they arrive, token-based "newest wins", LRU cache (text+voice+tier, ~30 entries), device `speechSynthesis` kept only as last-resort fallback. Same public API (`speakText`, `cancelSpeech`, `setSpeechEnabled`, etc.) so app, chat and orb mood keep working.
- `src/lib/audio-session.ts`: request `ambient` before playback; `play-and-record` only during Orby recordings; recover after `pagehide`/interruption by recreating the AudioContext.
- Migration: widen `user_preferences.tts_voice` check to the 10 voices, add `tts_high_quality boolean default false`.
- New `SoundSettingsDialog` component opened from Slot 4 in `src/routes/_authenticated/app.tsx`.
- Update `tests/speech.test.ts` for streaming, cancellation, cache, fallback order and no microphone use.
