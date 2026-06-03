## Goal

Make Orby's live call mode feel alive and responsive — like ChatGPT voice mode — and fix the iPhone bug where the mic turns on but nothing is transcribed.

## Decision

Move from the current "record clip → upload → Whisper transcribe → chat → device TTS" pipeline to the **OpenAI Realtime API (`gpt-realtime`) over WebRTC**, using the existing OpenAI API key.

Why this over the other options:
- **Option 1 (Whisper/gpt-4o-transcribe):** keeps today's architecture, so it inherits the iPhone problem (iOS Safari only records `audio/mp4`, and the short clips are often invalid MP4 fragments that transcribe to nothing). Even fixed, it stays turn-based and laggy.
- **Option 3 (device speech recognition):** `webkitSpeechRecognition` is unreliable/limited on iOS and gives the least control.
- **Option 2 (Realtime API) — chosen:** one low-latency streaming session handles listening + reasoning + speaking, with built-in server-side voice activity detection, natural turn-taking, and barge-in (you can interrupt Orby). WebRTC streams the mic directly, so it completely sidesteps the broken iOS MediaRecorder path. This is the architecture closest to ChatGPT voice mode.

The current document tools (read, add, mark for deletion, edit, jump, open, find, rename) are preserved by registering them as Realtime **function tools**, so the conversational experience improves without losing capability.

## What changes

### Backend (server function)
- Add a server function (e.g. `src/lib/orby-realtime.functions.ts`) that mints a short-lived Realtime ephemeral token by POSTing to OpenAI `realtime/client_secrets` with `OPENAI_API_KEY` (read server-side). It returns only the ephemeral `client_secret` value to the browser, never the real key. It also sets the session config: model `gpt-realtime`, a voice, the Orby system instructions (adapted from the existing call prompt), audio formats, and server VAD turn detection.

### Call engine (rewrite `CallModeContext.tsx`)
- Replace MediaRecorder + custom RMS VAD + clip upload with a WebRTC peer connection:
  - `getUserMedia` mic track added to the connection (still triggered from the user's tap, required by iOS).
  - Receive Orby's streamed audio on a remote track and play it through an `<audio>` element (replaces device `speechSynthesis`).
  - Open a data channel for Realtime events (transcripts, turn start/stop, tool calls, interruptions).
- Map Realtime events to the existing UI state (`status`, `partialUser`, `messages`, `actionLabel`) so the orb and `CallOverlay` keep working, including live captions and the "speaking/listening/thinking" states.
- Drive all existing document actions through Realtime **function tools**: each tool the model calls maps to the current server fns (`resolveDocumentsByVoice`, `readDocumentsForCall`, `addTextToDocument`, `markSentencesForDeletion`, `editSentence`, `renameDocumentTitle`) and the `CallController` bridge (open document, jump to sentence). Tool results are sent back into the session so Orby can speak a natural confirmation.
- Keep mic mute (disable the audio track), minimize/expand overlay, wake lock, and clean teardown (close peer connection, stop tracks, release token).

### UI (`CallOverlay.tsx`)
- Keep current layout. Swap the captioning source to Realtime transcript events and play remote audio via a hidden `<audio>`. Add a subtle "connecting…" state while the WebRTC session establishes.

## Notes / tradeoffs
- Uses the OpenAI Realtime API, billed on the OpenAI key already configured (audio in/out tokens cost more than text). I'll keep sessions scoped to active calls and tear them down promptly.
- If a device can't establish WebRTC, I'll fall back to a clear error (and we can optionally retain the old pipeline as a backup later).
- No database changes.

## Verification
- Confirm ephemeral-token server fn returns a token and never leaks the API key.
- Test a full call on iPhone Safari: mic captured, speech transcribed live, Orby replies with streamed voice, interruption works.
- Verify each document command (read/open/find/add/mark/edit/jump/rename) still works via tool calls, and that ending the call fully tears down the session.
