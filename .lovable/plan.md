# Chats as a live inbox: unread dots and unread-first ordering

## What you'll see

- A chat that got a new AI reply you haven't looked at yet shows a **blue dot** next to its title in the chats list, and its title turns bolder/brighter.
- Those unread chats **jump to the top** of the chats list, above everything else, sorted newest-first. Read chats keep the current "most recently used" order below them.
- Opening an unread chat clears the dot immediately (and clears it while you're sitting in the chat when a new reply lands there live).
- The 💬 chat button (Slot 11) and the chats-list header show a small **blue count badge** when one or more chats are unread, so you can tell from the home screen that Orby wrote you.
- The list refreshes on its own while the chats screen is open, so replies from scheduled messages and background plan runs show up without reopening anything.

This makes scheduled messages, background sends from the New idea composer, and finished plan replies all behave like an inbox: Orby writes you, you see the blue dot, you answer.

## How unread is decided

A chat is unread when its newest AI/assistant activity is more recent than the last time you looked at that chat. Only assistant activity counts — your own messages never mark a chat unread.

## Technical plan

### 1. Database (one migration, columns only — existing grants/RLS on `chat_threads` already cover them)

Add to `public.chat_threads`:

- `last_assistant_at timestamptz` — set whenever an assistant message is written to the thread.
- `last_read_at timestamptz` — set when the user views the thread.

Unread is derived client-side: `last_assistant_at > last_read_at` (or `last_assistant_at` set with `last_read_at` null). Backfill both columns to `updated_at` for existing rows so nothing shows up as unread on first load. Regenerate `src/integrations/supabase/types.ts`.

### 2. Write `last_assistant_at` everywhere an assistant message is created

- `src/lib/schedule-fire.server.ts` — the `insertChatMessage` helper (line ~101) already runs for scheduled fires and plan follow-ups; set `last_assistant_at` (alongside the existing `updated_at` bump) whenever `role === "assistant"`.
- `src/lib/chat-send.ts` — the background send path inserts assistant "plan"/"text" messages (lines ~119-142); include `last_assistant_at` in the final `chat_threads` update.
- `src/components/ChatDialog.tsx` — the in-dialog send path that inserts the assistant reply also stamps `last_assistant_at`, and immediately stamps `last_read_at` when the user is actively in that thread (so your own live conversation never shows as unread).

Plan-completion replies posted by the schedule/plan tick flow route through the same `insertChatMessage`, so they are covered by the first bullet.

### 3. Thread list: unread state, sorting, and badge (`ChatDialog.tsx`)

- Extend the `Thread` type and the threads query select (line ~345) with the two new columns; compute `unread` per thread.
- Sort: unread first by `last_assistant_at` desc, then read threads by `updated_at` desc. `bumpThread` keeps working; it just no longer overrides unread placement.
- List item (lines ~1522-1539): add a small blue dot before the title and a semibold title for unread threads, using existing semantic tokens (`primary` / `bg-primary`) so light and dark mode both stay correct.
- Mark read: when a thread becomes active (open from list, bootstrap, deep-link from a linked sentence, delegate flow), write `last_read_at = now()` and optimistically clear the dot in the cached list.
- Keep the list fresh while open: a light `refetchInterval` on the threads query (same pattern as the existing 30s schedules query) plus a refetch when the window regains focus. No new realtime channel, to avoid new failure modes.

### 4. Unread badge outside the chat (`src/routes/_authenticated/app.tsx`)

- A small `useQuery` (enabled when signed in, polled on the same light interval, refetch on focus) counts threads where assistant activity is newer than the read stamp.
- Render a compact blue count badge on the 💬 Chat menu button in Slot 11 and on the menu grid's chat tiles. Purely additive styling — no change to what the button does.

### 5. Safety / no regressions

- All new fields are nullable with a backfill, so existing threads, sends, schedules, and plan cards behave exactly as today if the columns are ever missing from a cached response (unread simply reads as false).
- No changes to message content, plan execution, capabilities, speech, or scheduling logic.
- Verification: build clean, existing tests run, and a preview pass that (a) confirms the chats list renders and opens normally, (b) simulates an assistant message arriving in a non-active thread and confirms it jumps to the top with a blue dot and badge count, and (c) confirms opening it clears the dot and badge.
