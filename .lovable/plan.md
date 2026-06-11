# Add a "Stop" button for running plans

Let users halt a plan that's currently running (or waiting on media). Setting a plan to `cancelled` already makes the client advancer and the server cron skip it, but we'll wire up clear UI buttons and close a race so an in-flight step can't silently resurrect a cancelled plan.

## What the user sees

- In the **AI Plans → Active** list, each running/active plan row gets a small **Stop** button. Tapping it cancels that plan; it moves to History → Cancelled.
- In the **Plan detail dialog** (opened for approved/running/awaiting-media plans), add a **Stop plan** button so a plan can be stopped from its detail view too.
- A confirmation ("Stop this plan? It can't be resumed.") plus a success toast.

## How cancellation works

Cancelling = setting the plan's `status` to `cancelled`.

- The client advancer (`use-running-plans-advancer.ts`) and the server cron (`plan-tick.ts`) only pick plans in `approved` / `running` / `awaiting_media`, so a cancelled plan is immediately ignored — no further steps run.
- A step that is mid-execution at the moment of cancellation will finish its current call, but must NOT flip the plan back to `running`/`completed`. We fix that race on the server (below).

## Changes

### 1. UI — Active list (`src/components/AIPlansScreen.tsx`)
- Add a `cancelPlan(planId)` helper that confirms, updates `plans.status` to `cancelled` for that id, then invalidates the `plans` and `plans_pending_count` queries with a toast.
- In `renderRow`, for rows whose status is in the active set (excluding `proposed`/`composing`, which already have the review flow), render a compact **Stop** button. Keep the existing row click for opening detail; stop the click from bubbling so tapping Stop doesn't also open the dialog.

### 2. UI — Plan detail (`src/components/PlanDetailDialog.tsx`)
- When `plan.status` is `approved`, `running`, `awaiting_media`, or `retrying`, show a **Stop plan** button that runs the same cancel update (confirm → set `cancelled` → invalidate queries → toast) and closes the dialog.

### 3. Server — make cancel win the race (`supabase/functions/plan-step/index.ts`)
- In `releaseClaim`, scope the final write so it can't overwrite a cancellation: change the update filter from `.eq("id", plan_id)` to also require `.neq("status", "cancelled")`. This way, if the user cancelled while the step was running, the post-step write is a no-op and the plan stays `cancelled`.
- Apply the same `.neq("status", "cancelled")` guard to the mid-step "persist running flag" write (currently `update({ steps, status: "running" }).eq("id", plan.id)`).
- Early-out: right after the claim, if `plan.status === "cancelled"`, release the claim and return without running a step (defensive; the existing non-running check at the bottom already covers most cases but this keeps intent explicit).

## Technical notes

- No schema change needed — reuse the existing `cancelled` status and `step_claim_at` claim mechanism.
- `plan-step` is redeployed after the edit.
- Existing `proposed`/`composing` plans keep their current Cancel-via-approval-dialog flow untouched; this adds Stop only for plans that are past approval and actually executing.
