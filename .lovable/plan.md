## Goal

Let the Orby planner (inside chat) create and manage the same scheduled plans that live on the AI Plans → Scheduled page (slot 14). If the user says things like "every weekday at 8am, run this…", "pause my morning schedule", "delete the yearly one", or "change my daily to weekly", Orby plans it, shows it in the approval sheet like any other plan, and on confirm actually writes/updates the row in `plan_schedules`.

## What ships

### 1. New planner tools (in `supabase/functions/_shared/tools.ts`)

Add these to `TOOL_CATALOG`, all in a new capability group `scheduling`:

- `find_schedule_by_title` — fuzzy locate one schedule by title (returns id, title, cadence, enabled, next_run_at).
- `list_schedules` — return every schedule for the user (id, title, cadence, interval_n, time_of_day, weekdays, month_days, year_month_days, timezone, starts_at, ends_at, max_runs, enabled, next_run_at). Planner reads this from the WORKSPACE SNAPSHOT (see §3) whenever possible; the tool is a fallback.
- `create_schedule` — args mirror `scheduleInputSchema` from `src/lib/plan-schedules.functions.ts`:
  - `title` (string, required)
  - `user_request` (string, required — the natural-language request that becomes the plan when it fires)
  - `attached_document_ids` (string[], JSON array of doc UUIDs, optional)
  - `cadence` (once|hourly|daily|weekly|monthly|yearly, required)
  - `interval_n` (number, default 1)
  - `time_of_day` ("HH:MM", optional)
  - `timezone` (IANA tz, default = the user's saved timezone from `user_preferences`, fallback UTC)
  - `weekdays` (0–6, JSON array)
  - `month_days` (1–31, JSON array)
  - `year_month_days` (JSON array of `{month, day}`)
  - `starts_at` / `ends_at` (ISO, optional)
  - `max_runs` (number, optional)
- `update_schedule` — `schedule_id` + any subset of the same fields.
- `delete_schedule` — `schedule_id`.
- `toggle_schedule` — `schedule_id`, `enabled` (boolean).

Register all six in `TOOL_GROUPS` as group `scheduling`.

### 2. Handlers (in `supabase/functions/plan-step/index.ts`)

Implement each new tool alongside the existing `TOOL_HANDLERS` using the admin client, scoped by `user_id`. The heavy piece is computing `next_run_at` on `create_schedule` / `update_schedule` / `toggle_schedule(true)`.

To avoid divergence from the frontend, extract `nextRunAt` / `nextNRuns` / `detectTimezone` / types from `src/lib/recurrence.ts` into a new `supabase/functions/_shared/recurrence.ts` (pure TS, no browser APIs) and re-export from `src/lib/recurrence.ts` so both the TanStack server fns and the Deno edge function share the exact same logic.

Handler behavior:

- `create_schedule` — enforce the same 50-schedule cap; compute `next_run_at`; if none, throw a friendly error ("that schedule has no future fire time"); insert with `enabled: true`, `run_count: 0`; return the row.
- `update_schedule` — merge patch onto existing row, recompute `next_run_at`; if none, set `enabled=false` and `next_run_at=null`; return the row.
- `toggle_schedule` — on enable, recompute `next_run_at` from now; on disable, just flip the flag.
- `delete_schedule` — delete and return `{ ok: true }`.
- Add the same required-arg checks to `validateExpansionSteps` so `expand_plan` can't emit malformed schedule steps.

Also add the same required-arg map for these tools inside `plan-compose`'s validation pass (mirrors what's already there for other mutating tools) so the composer rejects plans missing `schedule_id` on edits.

### 3. Planner context (in `supabase/functions/plan-compose/index.ts`)

Extend the WORKSPACE SNAPSHOT builder with a new **SCHEDULED PLANS** section, one line per row: `  <id> — <title> — <cadence every N> — next=<ISO> — <enabled|paused>`. That way the composer can pick an existing `schedule_id` from the snapshot for updates/toggles/deletes without an extra `find_schedule_by_title` call, exactly like it does for documents/media.

Add a short **SCHEDULING RULES** block to the system prompt: prefer using ids from the snapshot; `time_of_day` defaults to a sensible morning slot if the user didn't say; default `timezone` = user's saved tz; when the user says "every weekday", set `cadence=weekly` with `weekdays=[1,2,3,4,5]`; describe the schedule plainly in the plan step's `description` so the approval sheet reads well.

### 4. Chat capability toggle (in `src/components/ChatDialog.tsx`)

Add a new toggle "Scheduling" (key `scheduling`, hint "Create & edit scheduled plans") to `ACTION_TOOL_GROUPS` and the localStorage-backed `caps` map, defaulted **on**. It flows through to `plan-compose` via the existing `allowed_tool_groups` body param — no other wiring needed.

### 5. UI polish

Nothing on the AI Plans page changes. The existing `ScheduledPlansList` (which refetches every 15s and invalidates on save from `ScheduleEditorDialog`) will pick up rows Orby creates on its next refetch. Approval-sheet step descriptions surface the schedule details ("Create schedule 'Morning digest', weekly on Mon–Fri at 08:00") using the composer's `description` field, so users see what they're approving before Orby actually writes it.

## Non-goals

- No changes to how schedules fire (`plan-scheduler-tick.ts` stays as-is).
- No new page or component; existing Scheduled tab renders the results.
- No bulk "schedule for every doc" flows — those already work via `expand_plan` on top of the new tools.

## Technical details

- Files touched:
  - `supabase/functions/_shared/tools.ts` — 6 new entries in `TOOL_CATALOG`, 6 new entries in `TOOL_GROUPS`.
  - `supabase/functions/_shared/recurrence.ts` — new, extracted from `src/lib/recurrence.ts`.
  - `src/lib/recurrence.ts` — re-export from `_shared/recurrence.ts` (or keep as-is if TanStack can't import from `supabase/functions/_shared`; in that case keep both files in sync and add a header comment on both saying "keep in sync with the other copy"). Prefer the re-export path.
  - `supabase/functions/plan-step/index.ts` — 6 new handlers; extend `validateExpansionSteps` REQUIRED map with the new tools.
  - `supabase/functions/plan-compose/index.ts` — snapshot addition, prompt rules, and mirror the same REQUIRED map in its validator.
  - `src/components/ChatDialog.tsx` — one new capability toggle row.
- No DB migration — `plan_schedules` schema is already correct.
- Auth: handlers run under the plan's admin client, always scoping writes by `.eq("user_id", user_id)` (same pattern as every other mutating tool here).
- Approval: schedule mutations flow through the normal plan approval sheet — the composer produces the steps, the user taps Approve, then `plan-step` runs them. Matches the "user asks for that and approves that" requirement.
