# Upgrade hands-free mode to GPT-Live-1

## What GPT-Live-1 actually is

It is a new voice model with a new API surface (`/v1/live/sessions`), separate from the realtime model Orby's hands-free mode uses today. Two things matter for Orby:

1. **Full duplex** — it listens while it speaks, so it handles interruptions and back-channel ("wait, actually…") the way ChatGPT voice does, instead of the strict take-turns behavior we have now.
2. **Delegation** — the voice model only runs the conversation. The thinking and the doing are handed to a backend of our choice. Orby already *has* that backend: the chat turn runner and the multi-step planner.

That second point is the real unlock. Today hands-free mode is deliberately crippled: no plans, no document editing, no image or video generation, no web search, and Orby has to tell the user to hang up and type instead. With delegation, Orby can keep talking while the existing planner does the work in the background.

Cost is $0.05 per voice minute, plus normal cost for whatever the backend does.

## What changes for the user

Hands-free mode stays one button in the chat, same as now, but becomes far more capable:

- **Talk over Orby freely.** Interrupt mid-sentence, add a detail while she's answering, say "no, the other one" — she adapts without a hard stop/restart.
- **Ask for real work out loud.** "Write me a plan to clean up the Q3 doc and generate a cover image" now works during the call. Orby says she's on it, the plan is composed and run by the existing planner, and she narrates progress and the result out loud when it lands — the call never blocks.
- **Everything still lands in the chat.** Spoken turns are saved as chat messages exactly as today, and any plan created during the call appears as the normal plan card in that thread.
- **Approval stays deliberate.** Anything destructive (deleting sentences, overwriting a document, spending on media) is spoken back as a confirmation question and needs a spoken yes, or the existing plan approval card if "auto approve plans" is off for that thread.
- **The capability checkboxes stop being disabled.** They now control what Orby is allowed to do during the call, same as typed chat.
- **A natural American voice.** `gleam` (North American, feminine, natural) replaces today's `shimmer`; other voices can be exposed in chat settings later.
- **Stopping** works the same: tap the button, close the chat, or the floating "Hands-free live" pill.

What does not change: the push-to-dictate red mic button, "read replies aloud", the plans screen, and typed chat all keep working exactly as they do now.

## What happens on the back end

```text
browser mic ──WebRTC──► gpt-live-1 (conversation only)
                 │  data channel "oai-events"
                 │   ├── transcripts ──► saved as chat_messages (as today)
                 │   └── session.delegation.created ──► Orby backend
                 │                                        │
     spoken progress + result ◄── commentary/thinking ◄────┘
                                          (existing chat turn runner + planner)
```

- **New server function** `createLiveSession` replaces the ephemeral-token mint. GPT-Live has no ephemeral secret flow: the browser makes the SDP offer, our server posts it to `POST /v1/live/sessions` with the server-held `OPENAI_API_KEY` and returns only the SDP answer. The key still never reaches the browser.
- **Client delegation, not managed delegation.** `delegation: { type: "client" }` so the backend is Orby's own stack — the same `chat_turns` queue, `chat-core.server.ts` routing, planner tool groups, document context, and ownership checks that typed chat uses. One brain, two front doors; nothing is duplicated or re-implemented.
- **Delegated work is queued, not awaited.** On `session.delegation.created` the client queues a chat turn for the thread with the call's capability set and the recent transcript, then feeds the model `session.thinking.append` ("working on it, nothing done yet") so it can keep the conversation alive. When the turn finishes — reply text, plan created, plan step done, media ready — the result is pushed back as `session.commentary.append` and spoken.
- **Transcripts.** Live emits `session.input_transcript.delta` / `session.output_transcript.delta` fragments with no per-turn "done" event, so the client buffers fragments and commits a chat message on a short silence boundary. Today's self-echo and duplicate-turn guards are kept.
- **Document context.** The existing per-thread attached-document polling stays, pushed with `session.instructions.append` instead of a whole-session update.
- **Failure and cost control.** Mic denial, session errors, and dropped connections behave as they do today (clear toast, clean exit). One live session per user, an idle cutoff so a forgotten call can't bill indefinitely, and `store` left off.

## Technical notes

- New `src/lib/live.functions.ts` (auth-protected): mints the session via SDP exchange, builds instructions from `assistant-instructions.ts`, sets `audio.output.voice`, `delegation: { type: "client" }`, and seeds `session.input` with the thread's recent messages (128-message / 8,192-token cap).
- `src/lib/use-realtime-voice.ts` becomes `use-live-voice.ts`: same WebRTC shape and iOS audio-session handling, but the offer goes to our server, the data channel is created before the offer, and commands wait for `session.started`. No `session.start` on the data channel for WebRTC.
- `CALL_RULES` in `src/lib/assistant-instructions.ts` is rewritten: the "you can't do anything on a call" restriction is replaced with delegation and interruption policy, kept short per OpenAI's prompting guidance, with the detailed workflow rules staying in the backend prompt.
- `hands-free.tsx` gains delegation plumbing: queue a turn, subscribe to that turn and its plan, push `thinking`/`commentary` updates, and clear state on stop.
- The old realtime path (`realtime.functions.ts`, `gpt-realtime-2.1-mini`) is removed once the Live path is verified end to end, not left behind as a dead fallback.
- Verification: a real call that (a) holds plain conversation with an interruption, (b) asks for a plan out loud and hears the result, (c) denies the mic, (d) survives a mid-call document attach.
