# Voice context parity + natural verbatim speech

Two fixes: hands-free/voice requests get exactly the same context a typed chat request gets, and text-to-speech reads the sentence naturally instead of word-by-word.

## 1. Same context for voice as for typing

Today a typed chat turn is assembled on the server with: full attached documents (paginated so nothing is cut off), plan memory from this thread, the recent conversation, and Orby's system instructions. A hands-free call gets much less: only the last 10 chat bubbles that the browser happened to have loaded, plus the attached documents. No plan memory, no shared master instructions, and the history is whatever the client passed.

Changes:

- Add one shared context builder used by both paths. It produces the attached-document block, the plan-memory block, and the recent-conversation transcript from the thread itself (server-side, not from the browser).
- The hands-free session now starts from the thread id: the server reads the thread's attached documents, its recent messages, and its plan memory, and folds them into the call instructions. The browser no longer decides what Orby can see.
- Move Orby's identity and attached-document rules into one shared instruction constant. The voice path adds only its spoken-delivery rules (short answers, no markdown, stop when interrupted) on top of the same base instructions the typed path uses.
- The existing mid-call refresh keeps working and is upgraded: when documents are attached or removed during a call, the pushed update is rebuilt from the same shared builder, so removed documents stop being visible and new ones appear without restarting the call.
- Result: the user never has to ask Orby to "look at" or "find" an attached document on a call — it is already in context, by title, with full text.

Preserved as-is: the call still cannot edit documents, generate media, or run plans (that guard-rail text stays); every read stays behind the authenticated, row-level-security-scoped client, so a user can only ever pull their own threads and documents; document size caps stay so a long attachment can't blow the session limit.

## 2. Natural-sounding verbatim speech

The recent verbatim fix over-corrected: the steering text makes the model articulate each word in isolation, so it sounds like there's a period after every word. The instruction is rewritten to demand both things at once — read only the given text, no additions, no answering, no commentary, while delivering it with normal sentence rhythm, phrasing, and intonation as if reading aloud to a person. This lives in one place, so every voice in the picker gets the same behavior.

## 3. Tests

New tests (vitest, alongside the existing `tests/`):

- Context parity: with a stubbed backend, assert the typed-chat turn and the voice-session instructions contain the same document titles, the same full document text, the same plan-memory block, and the same recent-conversation lines — and that removing a document removes it from both.
- Voice instructions: assert the call instructions include the shared Orby identity plus the call-only restrictions.
- Speech steering: assert the text-to-speech request keeps the verbatim rule and includes the natural-delivery rule, and that the sentence text is passed through unchanged.

## Technical notes

- New `src/lib/assistant-context.server.ts`: `buildDocumentBlock`, `buildThreadTranscript`, `buildSharedContext` (docs + plan memory + transcript), reusing the existing pagination logic; `src/lib/assistant-instructions.ts` holds `ORBY_BASE_RULES`, `DOC_RULES`, `CALL_RULES`.
- `src/lib/chat-core.server.ts` delegates its `buildContext` to the shared builder (no behavior change to the typed path).
- `src/lib/realtime.functions.ts`: `createRealtimeSession` accepts `threadId` (optional client `context` kept as fallback); `buildRealtimeDocContext` returns the full refreshed context block. `composeRealtimeInstructions` stays the single composition point used by client and server.
- `src/lib/hands-free.tsx` / `ChatDialog.tsx`: pass `threadId`; drop the client-assembled 10-message transcript as the source of truth.
- `src/lib/tts-gateway.server.ts`: reword the steering preamble only; model, voice handling, streaming, error mapping unchanged.
