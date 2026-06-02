
## The bug

Your "every 2 hours" schedule fired a new plan roughly **every 5–6 minutes**. The database confirms it: ~30 plans were created back-to-back, all stamped with the same frozen `scheduled_for` of `2026-06-01 16:07:00`, and the schedule's `next_run_at` is still stuck at that same past time with `run_count` still at `0`.

This is **not** caused by the Run button. It's a flaw in the background scheduler.

## Root cause

The scheduler tick (`plan-scheduler-tick.ts`) does this for each due schedule, in order:

```text
1. Claim the schedule
2. Insert a new plan
3. Synchronously WAIT for plan-compose to finish   <-- slow LLM call
4. Re-fetch the plan and auto-approve it
5. FINALLY advance next_run_at + run_count + release claim
```

Step 3 calls the AI composer and waits for it. That call is slow and frequently exceeds the serverless function's time limit. When the function is killed mid-flight, step 5 **never runs** — so `next_run_at` is never moved forward.

Because `next_run_at` stays in the past, every scheduler tick keeps seeing the schedule as "due" and fires it again. The only thing throttling it is the 5-minute "stale claim" window — which is exactly the ~5-minute cadence you saw.

Two supporting facts confirm this:
- `run_count` is still `0` (the advance update never persisted).
- Steps 3–4 are now redundant anyway: `plan-compose` was already updated to auto-approve scheduled plans on its own, so the scheduler doesn't need to wait around for it.

## The fix

Reorder `fireSchedule` in `src/routes/api/public/plan-scheduler-tick.ts` so the schedule is advanced up front and the slow compose call can no longer block it:

1. After claiming and inserting the plan, **immediately** advance the schedule: set `next_run_at` to the next computed run time, bump `run_count`, set `last_run_at`, set `last_plan_id`, and release the claim. This happens before any compose work, so a timeout can't leave the schedule stuck.
2. Change the `plan-compose` invocation to **fire-and-forget** (don't `await` it), matching how the manual "Run now" path already works.
3. **Remove** the now-redundant synchronous re-fetch + auto-approve block, since `plan-compose` already auto-approves scheduled plans by itself.

Net effect: each schedule fires exactly once per its real cadence (every 2 hours in your case), the composer runs in the background, and a slow/timed-out compose can never cause repeat firings.

## Cleaning up the stuck schedule

The affected schedule (currently disabled, `next_run_at` frozen at `2026-06-01 16:07`) should also be reset so it doesn't immediately fire a backlog if re-enabled. I'll recompute its `next_run_at` forward from now as part of the fix.

## Technical notes

- File touched: `src/routes/api/public/plan-scheduler-tick.ts` (the `fireSchedule` function).
- No schema changes required.
- The 5-minute stale-claim window stays as a safety net for genuinely crashed ticks; advancing `next_run_at` up front is what stops the runaway loop.
- `runScheduleNow` (the Run button) is left unchanged — it correctly creates a single one-off plan without touching `next_run_at`.
