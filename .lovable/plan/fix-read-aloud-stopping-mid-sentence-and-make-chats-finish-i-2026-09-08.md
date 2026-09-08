# Fix read-aloud stopping mid-sentence, and make chats finish in the background

Two separate problems, two confirmed causes.

## 1. Speech stops and restarts mid-sentence

Two things in the speech engine can cut audio off:

**a) A stray "window regained focus" event kills playback.**
The speech engine listens for `focus`, `pageshow` and `visibilitychange` and treats any of
them as "the app just came back from being closed", which cancels whatever is being read and
throws away the audio engine. The only guard is "is the page visible" — which is true during
normal use. So an ordinary focus change (tapping the text box, closing a dialog, the keyboard
appearing, tapping back into the page) silently stops the sentence, and the next action starts
reading again. That matches exactly what you hear: a bit of speech, a stop, then more.

Fix: only treat it as a return-from-background when the page actually went hidden first.
Track a "we were hidden" flag set on `visibilitychange` to hidden; the recovery path (cancel
speech, rebuild the audio engine, reclaim the audio route) runs only when that flag is set,
then clears it. Ordinary focus changes during playback do nothing. If audio is playing and the
page never went hidden, never cancel.

**b) No buffer, so slow-arriving audio leaves gaps.**
Audio chunks arriving from the speech service are played the instant each one arrives, at
1.15x speed — so playback drains faster than the chunks arrive. Whenever the next chunk is
late, the schedule falls behind the audio clock and you get a short silence in the middle of a
word, then it picks up again.

Fix: add a small warm-up buffer. Hold arriving chunks until roughly one second of audio is
ready (or the sentence has fully arrived, whichever comes first), then schedule it as one
continuous run and keep appending later chunks to the end of that run. If a chunk still
arrives after the queue has run dry, re-prime with a fresh short lead-in instead of stitching
in a broken join. Cached and pre-warmed sentences keep playing instantly as they do today.

## 2. "Load failed" when leaving the app after sending a chat

Confirmed cause: the assistant reply is produced and saved by the phone, not the server. The
send waits for the server call to return, then the phone writes the reply into the chat. When
iOS suspends the tab (you switch apps), that call is torn down — you get "Load failed" and the
reply is lost even though the work started.

Fix: move the whole turn to the server and make it self-completing, using the same durable
pattern the scheduled chats and plans already use.

- New `chat_turns` queue table (thread, user, message payload, status, claim time, attempts,
  error) with row-level access limited to the owner and grants for the app and server.
- Sending a message: save the user's message, queue a turn row, then trigger a server call
  that runs the turn and writes the assistant reply (or creates the plan and its plan card)
  server-side. The phone no longer needs to survive the round trip.
- The chat screen shows "thinking" from the queued turn's status and picks up the reply by
  refreshing messages while a turn is open, plus an immediate refresh whenever the app comes
  back to the foreground. So switching apps and returning shows the finished reply.
- A dropped trigger call no longer shows an error toast; the turn stays queued.
- Watchdog: a public tick route claims any turn left pending or with a stale claim and
  finishes it, with a bounded retry count and a plain-language failure message written into
  the chat if it truly can't complete. The client also nudges this route on foreground return.
- Read-aloud keeps today's rule: a reply is only spoken if you are actually looking at that
  chat when it lands.

## Technical notes

- `src/lib/speech.ts`: gate `attachForegroundRecovery`/`handleAppForeground` on a real
  hidden→visible transition; add a prime-buffer (`PRIME_SECONDS ≈ 1.0`) with a monotonic
  playhead and underrun re-prime inside `speakText`'s `onChunk` path.
- Migration for `public.chat_turns` (CREATE TABLE → GRANTs → RLS → policies).
- New `src/lib/chat-turn.server.ts` running `runChatTurn` against the owner's rows and
  persisting assistant message / plan creation (extracted from `ChatDialog.handleSend`, same
  behaviour including auto-approve plans, capability merging and thread bump).
- New server function `runQueuedChatTurn` (auth middleware) plus
  `src/routes/api/public/chat-turn-tick.ts` for the watchdog, modelled on `plan-tick.ts`.
- `ChatDialog.tsx`: `handleSend` becomes queue-and-trigger; pending state from the turn row;
  message query refetch while pending and on `visibilitychange`; trigger failures are silent.

## Verification

- Typecheck, then a Playwright pass that sends a chat, hides the tab mid-turn, returns, and
  confirms the reply appears with no error toast.
- Read a long sentence aloud while focusing the text box and opening/closing a dialog, and
  confirm audio runs to the end without stopping.
