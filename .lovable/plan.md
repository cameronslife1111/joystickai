## Goal

Add full **scheduling** to Plan Mode: one-shot at a future time, or recurring (hourly / daily / weekly / monthly / yearly). Restructure the AI Plans screen so it's mobile-first, vertically scrollable, and groups everything cleanly. Reuse the offline execution pipeline you already shipped — the existing `pg_cron → /api/public/plan-tick` loop runs whether or not the app is open, so scheduled plans will fire reliably with the app closed.

## How offline execution works today (recap)

```text
pg_cron (every 10s)
   └─► POST /api/public/plan-tick
          └─► picks active plans with stale/null step_claim_at
                 └─► POST plan-step (internal_secret + user_id)
                        ├─ runs one tool, or
                        └─ launches a media job (generate-image, edit-image,
                           generate-kling-video, generate-heygen-avatar)
                           which themselves accept the internal secret.
                Guardrails: tick_count ≤ 300, no_progress ≤ 120, watchdog 2h.
```

Scheduling slots on top of this without touching the runner — we just need something to *create* `plans` rows at the right time.

## Architecture

```text
plan_schedules  (template: request, attachments, cadence, next_run_at)
       │
       │ pg_cron every 60s → /api/public/plan-scheduler-tick
       │   • finds schedules with next_run_at ≤ now() and enabled = true
       │   • enforces 30-min global spacing per user
       │   • inserts a fresh `plans` row (status='composing', schedule_id=…)
       │   • POSTs plan-compose, then auto-marks status='approved'
       │   • computes & writes next_run_at (or disables if cadence='once')
       │
       └─► plans row flows through the EXISTING plan-tick loop unchanged.
```

Auto-approval is safe because the user explicitly approved the *schedule* (and its preview plan) before it was saved.

## Database

New table `plan_schedules`:
- `id`, `user_id`, `created_at`, `updated_at`
- `title` (short label for the list)
- `user_request` (the prompt text)
- `attached_document_ids` (uuid[])
- `cadence` — enum text: `once | hourly | daily | weekly | monthly | yearly`
- `interval_n` (int, e.g. "every 2 hours", "every 3 days") default 1
- `time_of_day` (text "HH:MM", user's local TZ)
- `timezone` (IANA string, captured from browser)
- `weekdays` (int[] 0–6, for weekly)
- `month_days` (int[] 1–31, for monthly)
- `year_month_days` (jsonb `[{month:1-12, day:1-31}, …]` for yearly)
- `starts_at` (timestamptz; for `once` this IS the run time)
- `ends_at` (timestamptz, optional hard stop)
- `enabled` (bool, default true)
- `next_run_at` (timestamptz, computed)
- `last_run_at`, `last_plan_id`, `run_count`
- `max_runs` (int, optional cap)
- RLS: own-rows policies mirroring `plans`.

Add `schedule_id uuid` + `scheduled_for timestamptz` columns to `plans` so we can show provenance and avoid double-firing.

Indexes: `(enabled, next_run_at)` partial index for the scheduler tick; `(user_id, scheduled_for)` for spacing checks.

`compute_next_run_at(schedule) → timestamptz` written as a SQL function so both server code and pg can call it (used in tests and in the trigger that re-computes on update).

## 30-minute spacing rule

Enforced at three points:
1. **Schedule editor UI** — when the user sets a time, we preview the next 5 fires and red-flag any that collide with existing schedules' next fires for that user.
2. **Scheduler tick** — before firing schedule `S`, query `SELECT 1 FROM plans WHERE user_id = S.user_id AND scheduled_for BETWEEN now()-30min AND now()+30min` (excluding completed/cancelled). If a collision exists, **defer** by 30 min: write `next_run_at = next_run_at + 30min` and skip this tick.
3. **On schedule save** — if `next_run_at` collides with another enabled schedule, nudge it forward by 30 min and surface a toast: "Shifted to 9:30 AM to give the previous task time to finish."

## Server

New TanStack server route `src/routes/api/public/plan-scheduler-tick.ts`:
- Auth: same anon-key / shared-secret pattern as `plan-tick`.
- Per tick: pick up to 20 due schedules (oldest `next_run_at` first), apply spacing rule, create a `plans` row, invoke `plan-compose` with the saved attachments + request, set `status='approved'` once compose returns, then update `next_run_at`.
- Hard cap: 50 schedules per user, max 5 fires per user per tick.
- All updates wrapped in a SECURITY DEFINER RPC `claim_due_schedule(id)` so two ticks can't double-fire the same schedule.

pg_cron job `orby-plan-scheduler-tick` running every 60s (separate from the 10s plan-tick).

New auth-protected server fns in `src/lib/plan-schedules.functions.ts`:
- `listSchedules()` · `createSchedule(input)` · `updateSchedule(id, patch)` · `deleteSchedule(id)` · `toggleSchedule(id, enabled)` · `runScheduleNow(id)` (creates an immediate plans row, respects spacing) · `previewNextRuns(input)` (returns next 5 timestamps for UI feedback).

## UI redesign — `AIPlansScreen`

Restructure into a single mobile-first vertical scroll with **sticky segmented tabs** at the top:

```text
┌─────────────────────────────────────────┐
│ AI Plans                          Close │
├─────────────────────────────────────────┤
│  [ Active ] [ Scheduled ] [ History ]   │  ← sticky
├─────────────────────────────────────────┤
│  + New scheduled plan                   │  ← only on Scheduled tab
│                                         │
│  (cards…)                               │
└─────────────────────────────────────────┘
```

- **Active** = Awaiting approval + Planning + Running (collapsible subgroups).
- **Scheduled** = list of `plan_schedules`, each card shows:
  title · cadence chip · "Next: Tue 9:30 AM" · enabled toggle · ⋯ menu (Edit / Run now / Duplicate / Delete). Tap card → schedule detail.
- **History** = Completed + Failed + Cancelled (clear-all per group preserved).
- All cards use `shrink-0`, consistent vertical rhythm, full-width on mobile, `overscroll-contain`, safe-area-inset padding at the bottom.

## Schedule create/edit flow

Two-step wizard inside a single bottom-sheet (`Drawer` on mobile, `Dialog` on desktop):

**Step 1 — Describe**: reuse `PlanComposerDialog`'s prompt + attachments UI. Bottom row: `Cancel` · `Preview plan`.
- Tapping Preview runs `plan-compose` synchronously and shows the proposed step list (same UI as `PlanApprovalDialog`). The user can edit the prompt and re-preview.

**Step 2 — Schedule**: cadence picker as segmented control: `Once · Hourly · Daily · Weekly · Monthly · Yearly`. Under it, only the relevant inputs appear:
- Once: date + time picker.
- Hourly: "Every N hours", start time.
- Daily: time of day, "Every N days".
- Weekly: weekday pills (S M T W T F S, multi-select), time of day.
- Monthly: day-of-month chips 1–31 (multi-select), time of day.
- Yearly: month + day picker (multi-add).
- Optional: end date, max runs.
- Live "Next 5 runs" preview underneath, with red flag on any < 30 min from another schedule.
Footer: `Back · Save schedule` (or `Save & run now` if cadence=once and time is in the past + 5s).

Approval dialog gets a small footer addition: `Approve and run` (existing) · **`Approve and schedule…`** (new) — opens Step 2 pre-filled with the just-composed plan, so the offline-friendly "approve → schedule" loop works in one motion.

## Guardrails (recap, airtight checklist)

- Atomic claim via SECURITY DEFINER RPC prevents double-fire.
- 30-min spacing enforced at tick time (not just at save) — if two schedules drift into the same slot, the later one gets pushed.
- Max 50 active schedules / user, max 5 fires / user / tick.
- `enabled=false` is honored everywhere (UI + tick).
- `ends_at`, `max_runs` close out finished schedules cleanly.
- Existing watchdog/tick_count/no_progress guardrails on `plans` still cover each individual fire — no change to runaway protection.
- `cadence='once'` schedules auto-disable after firing.
- Timezone stored per schedule so DST changes don't drift the local "9 AM".

## Files

New:
- migration: `plan_schedules` table + RLS + `compute_next_run_at` + `claim_due_schedule` + `plans.schedule_id/scheduled_for`
- `src/lib/plan-schedules.functions.ts`
- `src/lib/recurrence.ts` (next-run math, shared client/server-safe)
- `src/routes/api/public/plan-scheduler-tick.ts`
- `src/components/ScheduledPlansList.tsx`
- `src/components/ScheduleEditorDialog.tsx`
- `src/components/CadencePicker.tsx`
- `src/components/NextRunsPreview.tsx`

Changed:
- `src/components/AIPlansScreen.tsx` — tabs, sticky header, new sections
- `src/components/PlanApprovalDialog.tsx` — add "Approve and schedule…"
- `src/components/PlanComposerDialog.tsx` — reused inside the wizard (extract its body to a sub-component so it can render without the outer Dialog)
- pg_cron: register `orby-plan-scheduler-tick` (60s)

## Out of scope (call out)

- No changes to how individual plans execute or to the 10s `plan-tick` loop.
- No timezone editor in v1 beyond auto-capture (can be added later).
- "Run again" on completed plans stays a follow-up; "Duplicate as schedule" gives a clean upgrade path.
