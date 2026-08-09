# Upgrade all red-circle transcription to OpenAI's new model + never lose a recording

## What the email means for Orby

OpenAI now ships two replacements for the older transcription model:

- **GPT-Transcribe** — for completed recordings uploaded as a file. Big accuracy jump (word error rate 15.21% down to 8.98% on real-world audio: accents, numbers, background noise, short phrases).
- **GPT-Live-Transcribe** — for continuous live captioning as you keep talking, over a streaming realtime connection.

Every red circle on Orby is push-to-talk: you tap, speak, tap again, and one finished clip is uploaded. That is exactly what **GPT-Transcribe** is built for, and it's the more accurate of the two. So all red circles move to GPT-Transcribe. (The hands-free call mode is a separate realtime feature and isn't affected by this change.)

## Where the red circles are (all share one code path)

- New Idea composer floating red circle
- Document editor floating red circle
- Chat message microphone
- Media gallery Voice Revise (image/video remix)
- Orb long-press voice capture

All of them go through the same dictation hook and the same server transcription call, so upgrading once upgrades all of them.

## 1. Model upgrade

- Switch the transcription request to `gpt-transcribe`.
- Adopt the new-model fields: a short `prompt` describing the context ("a person dictating notes and to-do items into a personal writing app"), a `keywords` list for terms Orby hears constantly, and `languages: ["en"]` instead of the old single-language field.
- Keep the JSON response format the new models require.

## 2. Never lose a transcription again ("Load failed")

"Load failed" is the browser reporting that the upload request itself died mid-flight (typical on 5G/spotty Wi-Fi). Today that throws away the recording. New behavior:

- **Keep the audio after recording stops.** The finished clip is held in memory until a transcript is successfully received.
- **Automatic retries** — up to 3 attempts with a short increasing delay, since a dropped upload usually succeeds on the next try.
- **If all retries fail, nothing is lost.** A small banner appears: "Transcription didn't send — Retry" so you can tap once to try the exact same recording again, as many times as you like. It also survives leaving the dialog: the pending clip stays available until it transcribes or you dismiss it.
- **Longer patience** — a generous timeout per attempt instead of failing fast, so slow-network uploads finish rather than erroring.
- **Clearer messages** — network failure ("couldn't reach the server, your recording is saved") reads differently from an actual empty/silent recording.
- **Server-side resilience** — the server call also retries once on a transient upstream error before reporting failure.

## 3. Nothing else changes

Same buttons, same red circle / black square behavior, same insert-and-append behavior everywhere. Only accuracy and reliability change.

## Technical notes

- `src/lib/whisper.functions.ts`: model to `gpt-transcribe`; add `prompt`, `keywords`, `languages` form fields; retry once on 5xx/network; keep the base64 WAV upload path.
- `src/lib/use-voice-dictation.ts`: hold the recorded `Blob` in a ref; wrap the server call in a retry loop with backoff; expose `pending`/`retry()`/`discard()` so the UI can offer a manual retry; distinguish network errors from empty audio.
- Consumers that render the button (New Idea, editor, chat, `VoiceReviseButton`, orb long-press) get a lightweight retry affordance from the hook's new state — no behavioral changes otherwise.
- `src/lib/audio-recorder.ts` stays as-is (16 kHz mono WAV is ideal input for the new model).
