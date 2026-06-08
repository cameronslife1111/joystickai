# Fix & Retry a Failed Plan (resume from the failed step)

## Goal

On the AI Plans → History tab, when a user opens a **failed** plan, add a **"Fix & Retry from this step"** button inside the existing "What went wrong" box. It opens a clean, mobile-optimized popup where the user can add an optional note (e.g. "don't use more than 10 reference images"). On submit, Orby re-reads the error + note, intelligently repairs the failed step (and any remaining steps), and resumes the plan **from exactly where it failed** — no starting over.

## Why this design

The plan runner (`plan-step`) executes each step's tool with fixed, pre-composed arguments — there is no LLM reasoning per step. So simply re-running the same step would fail the same way (e.g. the 16-image remix). To make Orby "understand the mistake," the retry must re-involve the planner LLM. We do this **without touching completed steps**: steps already done stay locked with their results intact; the planner only regenerates the failed step onward, given the error and the user's note. `current_step` stays put, so execution resumes at the failed index.

## How it works (flow)

```text
Failed plan (current_step = K of N)
        │  user taps "Fix & Retry", adds optional note
        ▼
plan-retry edge function
  • keep steps[0..K-1] (completed, results preserved)
  • send planner: original request + completed-step summaries
    + failed step + error_message + user note
  • planner returns corrected steps for index K..end
  • splice: steps = [...locked, ...newTail]
  • reset: status='approved', step_claim_at=null,
    error_message=null, completed_at=null,
    consecutive_no_progress=0, retry_count += 1, retry_note=note
        ▼
plan-tick cron (already running) picks up the 'approved' plan
and resumes execution at step K with the repaired args
```

## Backend changes

### 1. Migration — add audit columns to `plans`
```sql
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_note text;
```
(Existing grants/RLS on `plans` already cover these columns; no new grants needed.)

### 2. New edge function `supabase/functions/plan-retry/index.ts`
Modeled on `plan-compose` (same auth: user JWT **or** internal secret; same workspace-snapshot builder so the planner can still resolve doc/media ids). Differences:
- Loads the plan; rejects unless `status === 'failed'` and `user_id` matches.
- Computes `K = current_step`. Locks `steps[0..K-1]`.
- Builds a **repair prompt**: original `user_request`, a compact listing of locked steps (`index, tool, description, short result preview`) noting their results are referencable via `{{step_<index>.result...}}`, the failed step (tool + args + `description`), the `error_message`, and the user's note (clearly labeled as a hard constraint).
- Planner returns a corrected tail. We validate each step's tool against `TOOL_CATALOG` and normalize (`status:'pending', result:null, error:null`) exactly like `plan-compose`.
- Splice `steps = [...locked, ...newTail]`; update `total_steps`, keep `current_step = K`, set `status='approved'`, `approved_at=now()`, clear `error_message`/`error_lovable_prompt`/`completed_at`, reset `step_claim_at=null` and `consecutive_no_progress=0`, increment `retry_count`, store `retry_note`.
- The planner is instructed: completed steps 0..K-1 are LOCKED — do not re-emit them; produce only replacement steps starting at index K; you MAY reference any locked step's result by its absolute index; honor the user's note as an absolute constraint.

### 3. `supabase/config.toml`
Add:
```toml
[functions.plan-retry]
verify_jwt = false
```
(Auth is enforced inside the function, mirroring `plan-compose`/`plan-step`.)

## Frontend changes

### 4. New component `src/components/PlanRetryDialog.tsx`
A compact `Dialog` (reuses existing `@/components/ui/dialog`, `textarea`, `button`) optimized for mobile (`w-[calc(100vw-2rem)] max-w-md`, scrollable):
- Read-only context: "Failed at step K of N" + the error message.
- A `Textarea` labeled "Add a note for Orby (optional) — what went wrong or what to avoid".
- "Retry plan" primary button + "Cancel". On submit: `supabase.functions.invoke("plan-retry", { body: { plan_id, note } })`, show loading state, `toast.success("Retrying from step K")`, invalidate `["plans"]` + `["plan", planId, "detail"]`, close both dialogs. On error, `toast.error` and keep the dialog open.

### 5. `src/components/PlanDetailDialog.tsx`
Inside the existing `plan.status === "failed"` section (the "What went wrong" box), add a **"Fix & Retry from this step"** primary button next to the existing "Copy fix prompt" button. Clicking sets local state to open `PlanRetryDialog` with `planId`, the failed step number (`current_step + 1`), `total_steps`, and `error_message`. Keep the layout clean: buttons wrap in a `flex flex-wrap gap-2` row.

No change needed to `AIPlansScreen.tsx` — failed history rows already open `PlanDetailDialog`.

## Edge cases handled
- **Only failed plans** can be retried (status guard server-side + button only rendered for failed).
- **Locked completed work is never re-run or duplicated** — `current_step` is preserved and prior step results stay available for `{{step_N}}` references.
- **Resume is automatic** — setting `status='approved'` + clearing the claim lets the existing `plan-tick` cron pick it up; no new scheduler needed.
- **Validation** — unknown tools or malformed planner output throw and leave the plan `failed` with a fresh error message (same safety net as `plan-compose`), so a bad retry never corrupts the plan.
- **Auditability** — `retry_count` / `retry_note` recorded on the plan.

## Verification
After implementation: deploy `plan-retry`, run the migration, then invoke `plan-retry` against a known failed plan id via the server to confirm it returns `{ ok: true }` and the plan flips to `approved` with `current_step` unchanged; confirm the popup renders cleanly at mobile width in the preview.
