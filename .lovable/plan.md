## Goal

Two improvements to the "Fix & retry" feature we just shipped:

1. **Rewind a couple of steps** — when retrying, don't resume exactly at the failed step. Back up ~2 steps and re-run those (for consistency) along with the failed step and everything after.
2. **Run in the background** — pressing "Retry" should return instantly, close the dialog, and let the user navigate away (just like a normal running/composing plan). The slow planner-repair work happens server-side in the background.

---

## How it works today (context)

- `PlanRetryDialog` calls the `plan-retry` edge function and **waits** for it to finish. That function synchronously runs the planner LLM (can take 10-30s) while the user stares at a "Retrying…" button.
- `plan-retry` locks steps `0..K-1` (where `K = current_step`, the failed step), asks the planner to repair from index `K`, then sets `status='approved'` so the `plan-tick` cron resumes it.

---

## Changes

### 1. Database migration — new status value

The `plans.status` column has a CHECK constraint. Add a `'retrying'` state used while the background repair is composing (so the plan shows as active but `plan-tick` won't try to execute its stale failed step mid-repair).

```text
status IN (composing, proposed, approved, running, awaiting_media,
           completed, failed, cancelled, retrying)   -- add 'retrying'
```

### 2. `supabase/functions/plan-retry/index.ts` — rewind + background

**Rewind logic:**
- Introduce `BACKUP_STEPS = 2`.
- Compute `K = current_step` (failed index) and `startIndex = max(0, K - BACKUP_STEPS)`.
- `locked = steps.slice(0, startIndex)` (truly preserved, referenced by absolute index).
- Steps `startIndex..K-1` are "previously completed but intentionally rewound" — pass them to the planner as re-run candidates.
- Repair planner emits replacement steps starting at absolute index `startIndex` (failed step is at `K`). On success set `current_step = startIndex`.
- Update the repair prompt to explain: steps `0..startIndex-1` are locked; steps `startIndex..K-1` completed before but we're rewinding to re-run them for consistency; the failed step is at `K` with its error; re-emit everything from `startIndex` onward. Absolute indices are preserved so existing `{{step_N.result...}}` references to locked steps stay valid.

**Background execution:**
- As soon as the request is validated and the plan loaded, set the plan to `status='retrying'`, store `retry_note`, clear `error_message`, and **return immediately** (`{ ok: true, background: true }`).
- Run the heavy work (workspace snapshot + planner LLM + splice) inside `EdgeRuntime.waitUntil(...)` so it continues after the response is sent.
- On success: set `status='approved'`, `current_step=startIndex`, merged steps, increment `retry_count`, etc. (same as today). The `plan-tick` cron then resumes it.
- On failure: set `status='failed'` with a refreshed error message (same as today's catch block).

### 3. `src/components/PlanRetryDialog.tsx` — instant, fire-and-forget UX

- On "Retry plan": invoke `plan-retry`, then immediately close the dialog and show a toast like "Retrying in the background — safe to leave this screen." No more long "Retrying…" wait.
- Update the description copy to say Orby will resume "a couple of steps before the one that failed" instead of "from step N".
- Invalidate the `plans` / `plans_pending_count` / detail queries and call `onRetried()` as today.

### 4. `src/components/AIPlansScreen.tsx` — show the retrying state

- Add `retrying` to `STATUS_COLOR` (blue, like running) and to `ACTIVE_STATUSES` so it appears in the **Active** tab.
- In `handleRowClick`, treat `retrying` like a normal plan (open `PlanDetailDialog`, not the approval dialog).
- Row subtitle for `retrying` shows something like "Repairing…" instead of the step counter.

### 5. `src/components/PlanDetailDialog.tsx` — minor copy

- Keep the existing "Fix & retry from this step" button; pass current props. (Optionally relabel to "Fix & retry".) The dialog already closes on `onRetried`.

---

## Technical notes / safety

- **No `plan-tick` change needed**: it only selects `approved`/`running`/`awaiting_media`, so a `retrying` plan is never executed while its steps are still being repaired — this prevents the race where the cron would re-run the stale failed step.
- **Composing watcher unaffected**: `useComposingPlansWatcher` only watches `composing`, so `retrying` won't be auto-approved by it.
- **Index integrity**: because we rewind to `startIndex` and re-emit from there, locked indices `0..startIndex-1` never shift, so any `{{step_N.result}}` references the planner wires to locked steps remain correct.
- **Re-running side effects**: rewound steps (e.g. image generations) will run again and produce fresh outputs — this is the intended "start a couple steps earlier" behavior.
- `EdgeRuntime.waitUntil` is supported in the Supabase edge runtime and keeps the worker alive until the background repair completes.
