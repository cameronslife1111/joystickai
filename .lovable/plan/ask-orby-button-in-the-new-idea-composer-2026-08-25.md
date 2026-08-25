# 🤖 Ask Orby button in the New idea composer

## What you get

A new robot emoji button (🤖) floating on the right side of the New idea composer, stacked with the existing 🏆 and 🔴 buttons.

- Press it and whatever text is in the composer right now is sent to the AI as a plain question.
- While it thinks, the button shows a spinner and is disabled (so it can't be double-fired).
- The answer is appended into the composer, directly below your question, separated by a blank line — nothing is replaced or sent anywhere.
- From there every existing button still works as normal: Add to current, Send to…, Cancel, 🏆, 🔴 dictation. You can also edit or delete the answer by hand before sending.
- If the composer is empty the button is disabled. If the request fails you get an error toast and your text is untouched.

## Technical notes

- `src/lib/ai.functions.ts`: new `askAi` server function — `createServerFn({ method: "POST" })` with `requireSupabaseAuth`, input `{ prompt: string (1..100000) }`, returns `{ text }`. Uses the same `createOpenAiProvider(process.env.OPENAI_API_KEY)` + `gpt-5.5` and `generateText` pattern as the existing `generateText` fn, with an Orby system prompt asking for concise plain-text answers (no markdown/lists/headings), and throws if the response is empty. No database reads or writes, no sentence insertion.
- `src/routes/_authenticated/app.tsx`:
  - bind it with `useServerFn(askAi)` alongside the existing server-fn bindings.
  - new `askingAi` boolean state; handler trims `composeText`, calls the fn, then `setComposeText(prev => prev.trimEnd() + "\n\n" + answer)`.
  - render the 🤖 button next to the existing floating composer buttons (same `fixed right-[4vw]` style), positioned above 🏆 (roughly `bottom: 76svh`), using `onPointerDown` preventDefault so the mobile keyboard stays open.
- No database, schema, or other UI changes.
