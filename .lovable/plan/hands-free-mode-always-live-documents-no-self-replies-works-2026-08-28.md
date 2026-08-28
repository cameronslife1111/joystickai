# Hands-free mode: always-live documents, no self-replies, works app-wide

Three changes to make hands-free the main way you work.

## 1. Attached documents stay live during a call

- Attaching a document mid-call makes Orby aware of it within a second or two — no restart.
- Removing one makes Orby stop using it immediately.
- This keeps working even when the chat window is closed, because the call now tracks the thread's attachment list directly instead of only what the chat screen last showed.
- A short confirmation still appears when the live context changes ("Orby can now see 2 documents").

## 2. Stop Orby replying to herself / replying twice

Two likely causes, both addressed:

- Duplicate transcript events. The voice model emits more than one "done" event per turn (older and newer event names, and occasional repeats). Today both are accepted, so one spoken reply can be saved and treated as two turns. Fix: accept each turn exactly once, keyed on the event's item/response id.
- Orby hearing her own voice. The speaker audio can leak back into the mic and get transcribed as if you spoke, which starts a new reply — the "replying to itself" symptom. Fixes: enable noise reduction and echo-cancelled playback on the call audio element, and ignore an incoming user transcript that is a near-duplicate of what Orby just said.

Turn detection settings are also tightened so a brief noise burst doesn't open a new turn.

## 3. Hands-free keeps running while you use the rest of the app

- Starting a call and closing the chat no longer ends the call. You can navigate documents, open the gallery, browse the menu — and keep talking.
- Everything spoken still lands in the chat thread the call started in.
- The call ends when you tap the hands-free button again (or explicitly end it). Switching to a different chat thread still ends it, since a call belongs to one thread.
- While a call is live, all app-wide read-aloud (sentence speech, orb speak button, cues) is silenced so nothing talks over Orby or double-speaks. It comes back automatically when the call ends.
- A small persistent indicator shows a call is live while you're outside the chat, and tapping it ends the call.

## Technical notes

- New `src/lib/hands-free.tsx`: a `HandsFreeProvider` + `useHandsFree()` context that owns `useRealtimeVoice`, the call's `threadId`, and transcript persistence (moved out of `ChatDialog`). Mounted in `src/routes/_authenticated/app.tsx` above `ChatDialog` so call state outlives the dialog.
- The provider subscribes to its call thread: a Supabase realtime subscription on that `chat_threads` row plus a light poll fallback, so `attached_document_ids` changes reach the call even with the chat closed. On change it calls `buildRealtimeDocContext` and `voice.updateContext(block)` (existing server fn and channel path, unchanged).
- `ChatDialog.tsx` drops its local `useRealtimeVoice` call, doc-sync effect and `appendVoiceMessage`, and reads `useHandsFree()` instead. Remove the `if (!open) voice.stop()` effect; keep the thread-change stop, moved into the provider.
- `src/lib/use-realtime-voice.ts`:
  - Track `seenItems` / `seenResponses` sets; ignore repeat `input_audio_transcription.completed` and both spellings of the audio-transcript `done` event once a turn's id has been handled.
  - Keep the last assistant transcript; drop a user transcript whose normalized text is ~90%+ contained in it (echo guard).
  - Set `playsInline`, `volume` and echo-friendly attributes on the created `<audio>` element.
- `src/lib/realtime.functions.ts`: add `audio.input.noise_reduction: { type: "near_field" }` and keep `semantic_vad` with `interrupt_response: true`, with `eagerness: "auto"`.
- `src/lib/speech.ts`: add `setSpeechSuppressed(on)` (separate from the user's Sound setting) checked in `speakText`/`speakPlain`; the provider sets it true while `voice.live`, false on teardown, and cancels in-flight speech on call start. No TTS network requests fire while a call is live.
- Live-call indicator: a small fixed pill rendered by the provider when `voice.live` and the chat is closed.
