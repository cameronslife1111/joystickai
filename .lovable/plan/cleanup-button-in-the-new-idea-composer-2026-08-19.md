# Cleanup button in the New Idea composer

## What you get

A new **🧼 Cleanup** button in the New Idea (slot 13) button row. Pressing it:

1. Copies the current text to the clipboard first (same as Cancel does), so nothing can be lost.
2. Sends the text to the AI with a strict "fix only grammar/punctuation" instruction.
3. Replaces the composer text with the cleaned version when it returns.
4. Shows "…" while working and disables itself so double-taps can't fire twice.

If anything fails, the text is left exactly as it was and a toast explains the error (your copy is already on the clipboard).

## Button layout

The bottom buttons get two rows instead of one crowded row:

```text
[ Add to current ]  [ 🧼 Cleanup ]  [ Send to… ]
              [ Cancel ]
```

## The cleanup prompt rules

The instruction to the model is deliberately narrow:

- Fix grammar, spelling, punctuation, capitalization only.
- Keep the original wording and meaning as close to identical as possible.
- Preserve every emoji exactly, in place.
- Do not add, remove, summarize, reorder, or explain anything.
- Return only the corrected text — no preamble, no quotes, no markdown.

If the model returns empty text, the original text is kept.

## Technical notes

- New authenticated server function `cleanupText` in `src/lib/ai.functions.ts`, using the existing OpenAI provider (`createOpenAiProvider`, `OPENAI_API_KEY`) with a low-creativity single-shot call, input capped at 100k chars. Returns `{ text }`.
- `src/routes/_authenticated/app.tsx`: add `cleaningUp` state and a `runCleanup` callback (copy → call → `setComposeText`), restructure the `composing` action block into two rows (Add to current / Cleanup / Send to…, then Cancel below), keeping the existing copy-on-cancel behavior and the floating 🏆 / 🔴 buttons untouched.
- No database or schema changes.
