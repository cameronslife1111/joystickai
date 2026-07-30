## What's actually happening

I checked the database. The scheduling side is fine:

- Both cron jobs are active: `orby-plan-scheduler-tick` (every minute) and `orby-plan-tick` (every 10s).
- The schedule fired correctly on 07-27, 07-28 and 07-29 — a plan row was created at exactly 09:00:00 each day, with the app closed.

So the trigger works. The break is the next hop: every one of those scheduled plans is still `status = 'composing'`, `total_steps = 0`, no error. The plan was never written by the composer, so the step-runner never had anything to run.

Cause: the scheduler endpoint kicks off the composer with a fire-and-forget `void fetch(...)` and then immediately returns its HTTP response. In the serverless worker runtime, pending work that isn't awaited is cancelled the moment the response is returned — so the composer call is torn down before the LLM (which takes tens of seconds) finishes. Nothing ever moves the plan out of `composing`, and nothing retries it, so it sits there forever. When the app was open, client-side activity happened to keep things moving; closed, there's no second chance.

## The fix

**1. Don't fire-and-forget the composer**

In `src/routes/api/public/plan-scheduler-tick.ts`, stop using `void fetch`. Await the compose invocation (with a bounded timeout, ~25s) so the request is actually issued and given a real chance to complete. Because the schedule's `next_run_at` is already advanced *before* compose is called, a slow or failed compose can never cause duplicate firing.

**2. Add a composer watchdog to the 10s tick (the real durability fix)**

`src/routes/api/public/plan-tick.ts` currently only picks up plans in `approved` / `running` / `awaiting_media`. Extend it with a second pass:

- Find plans stuck in `composing` for more than ~2 minutes.
- Re-invoke `plan-compose` for them (same service-role + `internal_secret` call already used for `plan-step`), guarded by a claim timestamp so parallel ticks don't double-compose.
- After 3 failed attempts (or ~15 minutes stuck), mark the plan `failed` with a clear message like "Planning timed out — tap Fix & Retry" so it surfaces in the AI Plans page instead of hanging on "Composing" forever.

Also make `plan-compose` tolerant of being retried on a plan it already partially handled (it already 409s on non-`composing` status, which is the correct no-op).

**3. Small schema addition**

Migration adding two columns to `plans`:
- `compose_claim_at timestamptz` — claim guard so only one tick composes a given plan.
- `compose_attempts int not null default 0` — retry budget.

No new tables, no RLS/grant changes needed.

**4. Clean up the stuck rows**

Reset the two currently-stuck `composing` plans (07-28 and 07-29) so the new watchdog picks them up on the next tick, or mark them failed — I'll reset them so you can see the recovery path actually work.

## Technical notes

- Files touched: `src/routes/api/public/plan-scheduler-tick.ts`, `src/routes/api/public/plan-tick.ts`, plus one migration.
- The 10s `plan-tick` cron becomes the single source of truth for *both* composing and running plans, so any plan that stalls at any stage self-heals within ~2 minutes with the app closed.
- Per-tick fairness caps stay as they are; the composing pass gets its own small cap (max 3 recomposes per tick) so one tick stays well inside the request timeout.
