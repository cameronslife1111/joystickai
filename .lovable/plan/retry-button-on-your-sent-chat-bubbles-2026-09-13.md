# Retry button on your sent chat bubbles

## What you'll see

Every blue bubble you sent gets a small retry (↻) button underneath it. Tap it and Orby:

1. Deletes that message **and everything that came after it** in the chat (your message, Orby's replies, plan cards — all of it), so the conversation rewinds to the moment just before you sent it.
2. Immediately re-sends the same text as a fresh message, using whatever capability checkboxes, attached documents, and per-chat settings (like Auto approve plans) you have **right now** — so if you had the wrong things toggled the first time, you can fix the toggles and retry with the correct ones.

If Orby is still thinking about a message in that chat, retrying first stops that run (same as the Stop button) so it can't post a stray reply after the rewind. The retry uses only the bubble's text — it does not resurrect old image attachments. The button sits under user bubbles only, styled small and subtle, and shows a quick toast ("Retrying…").

## Technical notes

All in `src/components/ChatDialog.tsx`:

- New `retryMessage(msg: ChatRow)` handler:
  - If `busyThreads.has(threadId)`, call the existing stop/cancel path for that thread's pending `chat_turns` rows first (and clear busy state), so the old run can't write into the rewound chat.
  - Delete from `chat_messages` where `thread_id = msg.thread_id` and `created_at >= msg.created_at` (covers the bubble itself and everything after, including plan-card messages; uses the row's timestamp, so ordering matches what the user saw).
  - Update the `["chat_messages", threadId]` query cache by filtering out those rows (keeps it instant, no refetch flash).
  - Call the existing `handleSend({ text: msg.content, threadId })` — which already reads the current capability checkboxes, attached documents, sticky per-chat caps, and the thread's auto-approve setting at send time.
  - Errors delete-side → toast, no re-send.
- Render a small ghost/icon button (RotateCcw icon, `RotateCcw` from lucide) under each `role === "user"` bubble in the message list; hidden for the optimistic `tmp-` bubble while a send is in flight.
- No database, server-function, or planner changes — deletion and re-send use the existing tables and queue.

## Verification

Typecheck + build. Manual check: send a message with Web search off, toggle it on, hit retry under that bubble — the old exchange disappears and Orby answers again with search available; retrying while Orby is thinking stops the old run.
