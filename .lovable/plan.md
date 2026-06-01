# Auto-approve scheduled plans

## Goal
Scheduled plans (both the automatic cron fires and the manual "Run now" button) should skip the `proposed` approval step and run automatically, exactly like regular plans.

## Why it's currently broken
- `supabase/functions/plan-compose/index.ts` always sets a freshly composed plan to `status: "proposed"`.
- The cron path (`plan-scheduler-tick.ts`) auto-approves afterward via a post-compose refetch, but the manual run-now path (`runScheduleNow` in `plan-schedules.functions.ts`) does not — it depends on the in-browser watcher, so a scheduled plan stays stuck at `proposed` when nobody's watching.

## Fix (single, centralized change)
Every scheduled plan row already carries a non-null `schedule_id`. Use that as the signal.

In `supabase/functions/plan-compose/index.ts`, at the final success update (around lines 347–355):
- Load `schedule_id` from the plan (already selected via `select("*")`).
- If `plan.schedule_id` is set **and** `steps.length > 0`, set `status: "approved"` and `approved_at: new Date().toISOString()` instead of `"proposed"`.
- Otherwise keep the existing `"proposed"` behavior (this preserves the normal approval flow for non-scheduled plans, and still surfaces refusals where `steps` is empty so the user sees them).

This makes auto-approval work regardless of which path invoked compose, and removes reliance on the fragile post-compose refetch.

## Cleanup
- In `src/routes/api/public/plan-scheduler-tick.ts`, the post-compose auto-approve block (lines ~106–119) becomes redundant since the plan is already `approved`. Leave it as a harmless safety net, or simplify the comment — no behavior change needed.

## Result
- Cron-fired and manually-run scheduled plans go straight to `approved`, then the existing `plan-tick` cron picks them up and executes steps — no user approval prompt.
- Refusals (no steps) and non-scheduled plans are unchanged.

## Technical detail
`steps` is validated earlier in the function; the only change is the conditional `status`/`approved_at` in the success-path `.update(...)` call on the `plans` table.