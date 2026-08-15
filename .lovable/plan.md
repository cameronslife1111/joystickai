# Schedule chat messages, and turn AI Plans into a hub

Scheduling moves into the chat interface: you write a message in a chat, pick when it should send (once or repeating), and at that time Orby sends it in that chat for you — even if the app is closed. The AI Plans page stops being where you create schedules and becomes the place you look under the hood.

## Scheduling from chat

- A small clock button sits next to send in the chat composer. Tap it and you get the same timing options that the Scheduled page has today: once at a date/time, hourly, daily, weekly, monthly, yearly, with interval, time of day, timezone, start/end dates and a max-runs cap, plus a "next 5 runs" preview.
- Whatever is set up for that message is captured with it: the text, the checked capabilities (planning, document editing, image/video generation, web search), the documents attached to the thread, and any attached images.
- Confirming schedules the message instead of sending it. The composer clears and a "Scheduled" chip appears at the top of that chat listing what is queued for it, with the next run time. Tapping a chip lets you edit the timing, run it now, pause it, or delete it.
- Schedules created before this change keep running and show up in the hub; they simply have no chat thread attached.

## What happens at the scheduled time

The scheduler runs in the background on the server, so nothing depends on the app being open.

1. Your message is posted into that chat as if you had just typed it, so the conversation reads naturally.
2. Orby then handles it exactly like a live send, using the capabilities you saved with it:
   - Action requests (planning, document editing, image/video work, scheduling) become a plan attached to that chat, composed and auto-approved, and run step by step in the background. The plan card shows up in the chat like any other.
   - Plain questions get a normal Orby reply, posted into the chat.
   - Web-search requests get searched and answered, with the earlier conversation as context.
3. Repeating schedules advance to their next run; one-off schedules turn themselves off.

Existing safety rails stay: per-user fire caps per tick, 30-minute spacing between scheduled plans, stale-claim protection, and the watchdog that retries anything stuck composing.

## AI Plans as the hub

The page keeps every plan as a log and gains:

- **Search and filters** — search by request text, filter by status and by time range (today / 7 days / 30 days / all), and a filter for "from a schedule".
- **Per-step timeline** — expanding a plan shows every step in order with its status, what it did (tool and target document/sentence), its result summary, and the full error text plus repair notes when it failed.
- **Open source chat** — plans started from a chat get a button that closes the hub and opens that thread.
- **Rerun and retry** — rerun a completed plan with the same request, and keep fix-and-retry (rewinding a couple of steps) on failed ones, both running in the background.
- **Upcoming (read-only)** — the Scheduled tab becomes a read-only list of what is queued next, showing each item's chat and next run time, with a button that jumps into that chat to edit it. Creating and editing happens in chat.

## Technical notes

- Migration on `plan_schedules`: add `thread_id uuid references chat_threads(id) on delete cascade`, `capabilities jsonb not null default '{}'`, `image_urls text[] not null default '{}'`, `title` stays. Index on `(thread_id)`. No new table; existing RLS policies already scope to `auth.uid()`.
- Shared recurrence UI extracted from `ScheduleEditorDialog` into a `RecurrenceFields` component so the chat scheduling sheet and the editor share one implementation of cadence/preview logic (`src/lib/recurrence.ts` unchanged).
- `src/components/ChatDialog.tsx`: clock button in the composer, `ScheduleChatMessageDialog`, a scheduled-chip strip fed by a `plan_schedules` query filtered on `thread_id`, and create/update/delete via the existing `plan-schedules.functions.ts` (extended to accept `thread_id`, `capabilities`, `image_urls`).
- Chat routing logic in `src/lib/chat.functions.ts` (context build, classifier, web search, reply generation) is extracted into `src/lib/chat-core.server.ts` that takes a Supabase client. The auth'd server fn keeps its current behavior; the scheduler calls the same core with the admin client for the fired user.
- `src/routes/api/public/plan-scheduler-tick.ts`: for a schedule with `thread_id`, insert the `chat_messages` user row, run the shared core, then either insert a `plans` row with `thread_id` + `schedule_id` and await `plan-compose` (as today) or insert the assistant `chat_messages` row. Schedules without `thread_id` keep the current plan-only path. Cron cadence unchanged.
- `AIPlansScreen.tsx`: search/filter state over the existing `plans` query, expandable rows rendering `steps` (reusing `StepReasoning`), "Open chat" via `plans.thread_id`, rerun by inserting a new `plans` row + background compose, and the Scheduled tab switched to read-only.
