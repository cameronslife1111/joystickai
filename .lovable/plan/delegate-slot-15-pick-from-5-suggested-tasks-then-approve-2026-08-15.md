# Delegate (Slot 15): pick from 5 suggested tasks, then approve

Today the 🟣 Delegate button opens a new chat and immediately fires one prompt about the sentence you're on. Instead, it will now open a chat that first shows you five concrete things Orby could do for that part of the document, as checkboxes. You tick the ones you want, press Approve, and Orby turns exactly those into a single multi-step plan and works them one by one.

## New flow

1. Tap 🟣 Delegate in the menu. A fresh chat opens titled `Delegate: <document title>`, with the current document attached.
2. Orby reads the document around the sentence you're on — same analysis as today (is this line a substep or a full task, what is the parent task) — and proposes **5 suggested tasks**, worded as real actions it can carry out (e.g. "Research X online and add findings under this step", "Rewrite the three substeps below into clear instructions", "Generate an image for the concept in this line").
3. Those 5 appear as a checkbox card inside the chat, with a short line above them saying which task/parent task it detected. While it's thinking, the card shows a loading state.
4. You check any number of them (at least one) and press **Approve**. There's also a **Cancel** which just leaves the chat as a normal thread.
5. On Approve, the checked items are sent as one request. Orby composes one multi-step plan covering only the checked items and starts running it in the background — the usual plan card with progress and Stop appears in that chat.
6. The card becomes read-only afterwards (shows what was approved), so it can't be double-fired.

## Capabilities

- The plan is allowed to use **all** of Orby's capabilities — web search, document editing, image generation, video generation, scheduling, planning — so it can pick whatever each suggestion needs when it builds the plan. Each suggestion also carries the capabilities it expects, and those are guaranteed on.
- Scope stays tight: the plan may only do the checked items (and the parent task they belong to). It must not invent extra work, touch other steps it wasn't asked about, or other documents.

## Edge cases

- No document open / no sentences: same as today — "Nothing to delegate yet" toast, nothing opens.
- Suggestion generation fails: the card shows an error with a Retry button; the chat still works normally.
- Approve with nothing checked is disabled.

## Technical notes

- `src/lib/delegate-prompt.ts`: keep the document-window builder, split into two prompts — one that asks for 5 suggestions as structured JSON (`{ title, detail, capabilities[] }` plus a `task_context` line), and one that composes the final plan request from the checked suggestions + the same document window + the scope rule.
- New server function (e.g. `src/lib/delegate.functions.ts`, auth-gated, `gpt-5.6-terra` via the existing `createOpenAiProvider`) that takes `{ documentId, index }`, loads the sentence window server-side, and returns the 5 suggestions. Structured output, plain text wording, no markdown.
- `src/routes/_authenticated/app.tsx`: `handleDelegate` no longer builds a send prompt; it sets a payload of `{ id, documentId, title, sentences window, index }` and opens `ChatDialog`.
- `src/components/ChatDialog.tsx`: the `delegate` prop changes shape accordingly. On open it creates the thread, attaches the document, calls the suggestions function, and renders a new `DelegateSuggestionsCard` (new component under `src/components/`) inline in the message area. Approve calls the existing `handleSend` override path with the composed prompt and all capabilities on, so the existing chat → plan-compose → plan-step flow runs unchanged.
- No schema change, no edge-function change; the approved request goes through the normal `route: "plan"` branch already in `handleSend`.
