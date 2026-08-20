# Send a New idea straight into a chat

Add a "Chats" option to the New idea → **Send to…** flow, so the text can be dropped into an existing chat (or a brand-new one) and answered in the background while you stay exactly where you were.

## What changes for you

1. In the New idea composer, pressing **Send to…** now shows two tabs at the top of the sheet — **Docs** and **Chats** — the same style as the "Link this sentence" popup.
2. **Docs** tab: unchanged (emoji filters, search, pick a list, then choose where in the list).
3. **Chats** tab:
   - A search box plus the list of your chats, most recently used first.
   - A **➕ New chat** button at the top that creates a fresh chat and sends the text there.
   - Tapping a chat sends your composer text into that chat immediately.
4. After sending to a chat:
   - The composer closes and you land back on the exact document and sentence you were on (no navigation, no chat window opening).
   - A toast confirms it ("Sent to <chat title>").
   - Orby processes the message in the background. If the request needs a plan, the plan is created and auto-runs, exactly like it would inside the chat. Next time you open that chat, the message and Orby's reply are already there.
   - New chats get their short auto-generated title in the background, same as normal chats.

## Technical notes

- New shared helper `src/lib/chat-send.ts` — a headless version of the send pipeline currently living inside `ChatDialog.handleSend`:
  - loads existing `chat_messages` for the thread (ordered) to build history, mapping `kind === "plan"` rows to the same short marker string,
  - inserts the user row,
  - calls the `sendChatMessage` server function with the thread's stored `capabilities` (normalized via `normalizeCapabilities`) and the thread's `attached_document_ids` as context,
  - handles the three routes exactly like the dialog: `resumed` (no assistant row), `plan` (insert `plans` row, invoke `plan-compose` with the allowed action groups, insert the `kind: "plan"` chat message), otherwise insert the assistant text row,
  - bumps `chat_threads.updated_at`.
  - It takes the `sendChatMessage`/`generateThreadTitle` callables as arguments so it stays client-safe and reuses the existing `useServerFn` bindings.
- `src/routes/_authenticated/app.tsx`:
  - `sendStage` gains a `"chat"` stage; a `sendTab` state (`"docs" | "chats"`) renders the tab strip in the existing send overlay, only while `sendStage === "doc"`.
  - New query for `chat_threads` (`id, title, capabilities, attached_document_ids, updated_at`, ordered by `updated_at desc`), enabled only when the send overlay is open, plus a local search filter.
  - `sendIdeaToChat(threadId | "new")`: resolves/creates the thread, captures the composer text, calls `cancelCompose()` right away so the user is back on their sentence, then fires the helper without awaiting (errors surface as a toast, success as a toast). Invalidates `["chat_threads", userId]` and `["chat_messages", threadId]` so `ChatDialog` picks the rows up when opened.
  - `userId` comes from `supabase.auth.getUser()` inside the handler (the route is already auth-gated), since the component doesn't track it today.
- `ChatDialog.tsx` is refactored only if needed to export the shared capability constants (`DEFAULT_CAPS`, `ACTION_TOOL_GROUPS`); those move into `src/lib/chat-send.ts` and are imported back, so its behaviour is unchanged.
- No database or server-function changes.
