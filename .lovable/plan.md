# Stop the read-aloud voice when you tap the record button

## The problem

With "Read replies aloud" on, tapping the red circle to start talking begins recording while the voice keeps reading the bubble out loud. Your own recording then has Orby talking over it.

## The fix

- Tapping the red circle first stops any reading in progress and clears the "playing" state on the bubble, then starts recording as usual.
- Only affects starting a recording; tapping the black square to stop and transcribe behaves exactly as before.
- Everything else stays the same: per-message play buttons, auto-read on opening a chat, and hands-free calls.

## Technical notes

`src/components/ChatDialog.tsx`, the mic button `onClick` (~line 1634): if not already recording, call `cancelSpeech()` and `setSpeakingId(null)` before `dictation.toggle()`. No changes to `src/lib/speech.ts` or `use-voice-dictation.ts`.

## Verification

Start a reply reading aloud, tap the red circle, and confirm the voice cuts off immediately and recording begins.
