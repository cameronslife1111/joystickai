# Delegate button (Slot 15)

Replace the current Slot 15 menu button (🗑️ Mark trash) with a new 🟣 Delegate button. One tap hands the step the user is standing on to Orby: it opens a fresh chat, attaches the current document, turns on the right capabilities, and sends a tightly-scoped prompt that makes Orby plan and run exactly that step — nothing more.

## What happens on tap

1. The menu closes and a brand-new chat thread opens, titled `Delegate: <document title>`.
2. The current document is attached to that thread automatically.
3. Capabilities are pre-checked for that first send: Planning / multi-step, Document editing, Image generation. Web search is also checked when the current sentence mentions "web", "search the web", "online", "look up", or a URL.
4. A prompt is composed and sent automatically — the user does not have to type or press send.
5. Orby's normal chat-planning path takes over: it composes a plan and kicks it off in the background, and the plan card appears in that chat with progress and a Stop button, exactly like a plan started by hand.

## The prompt Orby receives

Plain text, built from the live document state:

- The document title, the total number of sentences, and the current position.
- The exact text of the current sentence, marked as the step to do.
- A short window of surrounding sentences (a few before and after) so Orby can tell whether the current line is a substep of a larger task or a standalone task.
- Instructions: analyze the document, determine whether the current line is a substep or a full task; if it is a substep, work the full parent task it belongs to; if it is a full task, work that task. Then write a complete plan for that task and start it.
- A hard scope rule: do only what the current step (or its parent task) says. Do not add, invent, or extend work the document does not ask for. Do not touch other steps or other documents.

## Edge cases

- No document open or no sentences yet: show a short toast ("Nothing to delegate yet") and do nothing.
- The Delegate chat is a normal thread afterwards — the user can keep talking in it, and the capability checkboxes go back to unchecked after that first automatic send, as they do everywhere else.

## Technical notes

- `src/routes/_authenticated/app.tsx`: replace `filled[14]` (currently `grid[25]`, Mark trash) with the Delegate entry. The 🗑️ Mark trash action stays defined in the grid array but is no longer placed in a slot. The handler builds a delegate payload from `activeDoc`, `sentences`, and `currentIdx`, stores it in state, and opens `ChatDialog`.
- `src/components/ChatDialog.tsx`: add an optional `delegate` prop (`{ documentId, prompt, capabilities } | null`). When present at open time it takes priority over the normal bootstrap: create a new thread, set `attached_document_ids` to the current doc, seed `pendingCaps` from the payload, and fire the existing `handleSend` path once with the composed prompt. Guarded by a ref so it runs once per open and never re-fires on refetch.
- Prompt composition lives in a small helper (e.g. `src/lib/delegate-prompt.ts`) so the wording is in one place.
- Reuses the existing chat → `sendChatMessage` → plan-compose flow; no changes to edge functions, tables, or plan logic.
