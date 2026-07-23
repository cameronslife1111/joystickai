
## What's actually wrong

The long-press wiring in `src/routes/_authenticated/app.tsx` is already correct — it calls `dispatchVoiceEdit` → `voiceEditDocument`, and nothing on that path creates a chat thread or runs the planner (`rg` confirms no `dispatchVoiceMessage`, `chat_threads`, or `sendChat` calls in the long-press handler).

What's failing is the server function itself, which is silently doing nothing — so the user sees no edits land, and the chat/plan behavior they're describing is the *previous* long-press flow they remember, not new activity. Root causes in `src/lib/voice-edit.functions.ts`:

1. It uses `gpt-5.5` — the user explicitly wants `gpt-5.6-sol`.
2. On any AI/JSON error it returns `{ appliedCount: 0 }` with only a `console.error`, so from the UI it looks like "nothing happened".
3. No structured-output enforcement, so the model sometimes replies with prose that fails `tryParseJson`, again producing zero ops.

## Fix

Edit only `src/lib/voice-edit.functions.ts`:

- Switch model from `gpt-5.5` to `gpt-5.6-sol` (same `createOpenAiProvider(OPENAI_API_KEY)` — no other change to auth).
- Ask the model for JSON explicitly via `response_format: { type: "json_object" }` on the OpenAI-compatible call (using the provider's `providerOptions`/`response_format` pass-through), and keep the existing `tryParseJson` as a fallback.
- Tighten the system prompt so it always returns `{"ops":[...]}` even when it only understands part of the request; add a one-line reminder that the target document and current sentence index are already provided and it must not ask questions or defer.
- Surface real errors to the client: if the AI call throws or returns unparseable JSON, `throw new Error("Voice edit AI failed: …")` instead of swallowing it, so the toast shows a real message instead of "No edits recognized".
- Keep the executor, Perplexity path, RPC calls, and return shape unchanged.

No changes to `app.tsx`, `whisper.functions.ts`, `chat.functions.ts`, `ChatDialog`, or any DB schema. Long-press stays document-scoped exactly as intended; only the model + error surfacing get fixed.

## Verification

1. Long-press orb on a document, say "change this sentence to hello world", long-press again.
2. Expect toast: Transcribing… → Editing document… → ✅ Updated 1 sentence, view jumps to that sentence, no new chat thread appears in the chat drawer.
3. If OpenAI errors, the toast now shows the actual reason instead of silently doing nothing.
