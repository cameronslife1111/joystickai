# Hands-free voice chat in the chat window

Add a real-time, interruptible voice conversation mode to the chat, with a redesigned chat header so the full thread title is always visible.

## Header redesign

The chat header becomes two rows:

```text
Row 1:  [☰ threads]                [🎙 Hands-free]  [🗑 clear]  [⚙ settings]
Row 2:  Full chat title (wraps to 2 lines, no truncation)
```

- Row 1 keeps the existing controls and adds the new Hands-free button (it shows an active/red state while a call is live).
- Row 2 shows the complete thread title instead of the current single-line truncated title.

## Hands-free mode behavior

- Tapping Hands-free starts a live voice session: the user just talks, Orby answers out loud, and the user can talk over Orby to interrupt mid-sentence.
- The voice is a natural American female voice from the realtime voice model — not the browser's built-in speech synthesis.
- Everything spoken still lands in the chat: the user's speech is written as a user message and Orby's reply as an assistant message in the same thread, saved like normal messages.
- Text-only in this mode. While a call is live, planning, document editing, image/video generation and web search are off, and Orby is instructed to say it can help with that once hands-free mode is stopped. The capability checkboxes are disabled while live.
- Tapping the button again (or closing the chat) ends the call and releases the microphone.
- Orby's context for the call includes the thread's recent messages so the conversation continues naturally; attached-document editing is not part of this mode.
- If the mic is denied, or the connection fails, a clear toast appears and the mode exits cleanly. The existing push-to-dictate mic button and "Read replies aloud" setting stay as they are, but auto-speak is suppressed during a call so replies aren't spoken twice.

## Technical notes

- New server function `src/lib/realtime.functions.ts` (auth-protected) mints a short-lived OpenAI Realtime client secret using the existing server-side `OPENAI_API_KEY`; the key never reaches the browser.
- New client hook `src/lib/use-realtime-voice.ts` opens a WebRTC peer connection to OpenAI's Realtime API with that ephemeral token: mic track up, remote audio element down, plus a data channel for session config and events. Server-side VAD handles turn-taking and barge-in interruption natively.
- Session config: text + audio modalities, a female American voice (`shimmer`-class realtime voice), input-audio transcription enabled, and a system instruction that restricts the call to plain-text conversation (no plans, no doc edits, no media).
- Transcript persistence: on each completed turn, insert the user transcript and the assistant transcript into `chat_messages` for the active thread (assistant text passed through the existing `toPlainText` helper), then invalidate the messages query so bubbles appear live.
- `ChatDialog.tsx` owns the call state, passes the active thread id and recent messages to the hook, gates capability checkboxes, and cleans up on unmount/close.
