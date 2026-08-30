# Linked-chat pill status dot: yellow while working, green when done

## Goal
On the "Linked chat" pill shown under a sentence (above Orby), replace the 💬/MessageSquare icon with a small status dot emoji:
- 🟡 yellow while that chat thread is still working (a plan is composing/running/paused, or the last message is the user's with no reply yet)
- 🟢 green when it's finished (latest plan completed/failed/cancelled, or the assistant already replied)

The pill's size, layout, and tap behavior stay unchanged — only the leading icon becomes a colored circle.

## How status is determined
For the sentence's `linked_thread_id`:
1. Query `plans` for that `thread_id`. If any plan has status in `composing | proposed | approved | running | awaiting_media | retrying` → **working (yellow)**. (`completed | failed | cancelled` count as done.)
2. If no active plan, look at the newest `chat_messages` row for the thread: last message `role = 'user'` → still waiting for the assistant → **yellow**; `role = 'assistant'` → **green**.
3. Fallback (no data / error): green, so the pill never looks stuck.

A tiny helper `useLinkedThreadStatus(threadId)` (React Query, ~5s `refetchInterval` while the pill is visible) fetches both pieces in two lightweight queries (`plans`: `select status, order by created_at desc, limit 1… few`; `chat_messages`: `select role, order by created_at desc, limit 1`). Result: `'working' | 'done'`.

## Changes
- `src/routes/_authenticated/app.tsx`
  - Add the `useLinkedThreadStatus` hook (or put it in `src/lib/` if cleaner).
  - In the linked-chat pill block (~line 2875), replace `<MessageSquare />` with `🟡` or `🟢` (small text size matching current icon) based on the hook; keep everything else identical.

## Notes / edge cases
- No database changes — `plans.thread_id` and `chat_messages.thread_id` already exist and RLS already scopes them to the user.
- Poll interval only while the pill is rendered; stops when navigating away or unlinking.
- If the linked chat is open and actively generating, the dot flips to green shortly after the assistant message lands.
