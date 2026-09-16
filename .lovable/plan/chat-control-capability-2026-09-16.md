# Chat Control capability

Add a new chat setting called **💬 Chat control**. When it's checked on in a chat, that chat's multi-step planner can manage your other chats: make new ones, rename them, change which documents are attached, and message another chat and bring its answer back.

## What the planner gains

- **Create a chat** — makes a new chat with a title you (or Orby) name.
- **Rename a chat** — you can name the target loosely ("the DaVinci one") and Orby matches it.
- **Attach documents to a chat** / **remove attached documents** — same list the paperclip shows.
- **Ask another chat** — sends a message into that chat exactly as if you typed it, waits for that chat's reply, and hands the reply back into the plan so a later step can use it.

The target chat answers with its own capabilities and its own attached documents, so a chat set up for one job can be asked to do that job by another chat.

## Rules and guardrails

- Off by default, per chat, sticky like the other toggles.
- Only your own chats and documents are ever touched.
- A chat can't ask itself (that would wait forever); Orby is told to use its normal in-chat status message for that.
- Waiting for another chat's reply has a time limit (about 3 minutes). On timeout the step reports "no reply yet" instead of hanging the plan.
- Loose names match the best chat and the resolved chat title is reported back, so the plan and the chat log show which chat was used.

## Technical notes

New capability key `chat_control` threaded through the existing plumbing:

- `src/lib/chat-types.ts` — add to `capabilitiesSchema`, `ALL_CAPS_ON` (false), `normalizeCapabilities`, `ACTION_GROUPS`.
- `src/components/ChatDialog.tsx` — add to `DEFAULT_CAPS` (false), `NO_CAPS`, `CAP_LABELS` (💬 Chat control), `ACTION_TOOL_GROUPS`.
- `src/lib/chat-send.ts`, `src/lib/chat-turn.server.ts`, `src/lib/schedule-fire.server.ts` — add to their `ACTION_TOOL_GROUPS` / default-caps lists.
- `src/lib/chat-core.server.ts` — one short capability note so the chat model knows it can plan chat management when the toggle is on.

Planner tools (`supabase/functions/_shared/tools.ts`, group `chat_control`):
`create_chat`, `rename_chat`, `attach_documents_to_chat`, `remove_documents_from_chat`, `list_chat_attachments`, `ask_chat`.
Each accepts either a concrete `thread_id` or a loose `chat` string resolved with the existing fuzzy chat scoring.

`supabase/functions/plan-step/index.ts` — handlers for those tools using the admin client scoped by `user_id`:
- `ask_chat` inserts a `role:"user"` message into the target thread, then queues a `chat_turns` row with the target thread's own capabilities, attached documents, and prior history (same payload shape the app queues), and polls `chat_messages` for the next assistant row in that thread. Returns `{ thread_id, title, reply, timed_out }`. Existing client/scheduler watchdogs already run queued turns, so no new tick is needed.
- Rejects `ask_chat` targeting the plan's own `thread_id`.

`supabase/functions/plan-compose/index.ts` — a short Go To Format guidance block, shown only when `chat_control` is allowed, covering when to use `ask_chat` vs `send_chat_message` and to resolve the chat first.
