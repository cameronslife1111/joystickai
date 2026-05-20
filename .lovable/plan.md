## What actually happened

The failing plan (4 steps, all `move_sentence` into doc `45A` with `position: "after_current"`) tripped `sentences_doc_order_uidx`. Tracing the data:

- The target doc (45A) has rows at order_index 0–21, 23, 24, 25 (no duplicates, one natural gap).
- The source sentence `040bfe07…` no longer exists — it was already moved by a prior run of this same step.
- The plan's row shows step 1 status=`failed`, but it succeeded ENOUGH to delete the source — meaning the step ran more than once.

That's the smoking gun: **`plan-step` has no concurrency guard**, so the same step can execute twice in parallel.

```text
poll tick A (tab 1)            poll tick B (tab 2 / second invoke)
─────────────────              ─────────────────
load plan, idx=0               load plan, idx=0
shift rows >=19 in 45A         shift rows >=19 in 45A     ← collides
insert content at 19           insert content at 19       ← duplicate (doc, order_index)
delete source sentence         throws "duplicate key…"
update current_step=1          step marked failed, plan failed
```

The client-side `inFlight` Set in `useRunningPlansAdvancer` only prevents same-tab re-entry. Two tabs, or a manual "approve" + the auto-poller, race freely. Once a step half-succeeds, the source sentence is gone, so the next replay also can't recover.

## Verified: no real "old plan leak"

I read `plan-compose` end to end. The planner prompt is rebuilt from scratch every call from:
- The user's current request
- A fresh workspace snapshot (docs + media + sentences from the DB right now)

There is no path that injects prior plan steps, prior LLM outputs, or another plan's `steps` JSON into a new plan. What feels like "remembering old plans" is actually:
1. The planner sees content the user previously wrote into their docs (legitimate snapshot), and
2. The same step gets executed twice because of the race above, which makes the run look like it's repeating itself.

I'll add a brief comment in `plan-compose` documenting that the snapshot is the only cross-request input, so future readers don't have to re-verify.

## Fix

### 1. Atomic claim on `plans` (the actual bug)

Add a `step_claim_at timestamptz` column. In `plan-step`, before doing anything mutating:

```sql
UPDATE plans
SET step_claim_at = now()
WHERE id = $1
  AND user_id = $2
  AND (step_claim_at IS NULL OR step_claim_at < now() - interval '90 seconds')
RETURNING id, status, steps, current_step, total_steps;
```

If the update returns 0 rows, another worker holds the claim — return `{ status: "running", note: "already_running" }` and let the next tick try again. On success, the returned row is the source of truth for `steps` / `current_step` (so we never act on a stale in-memory snapshot). Clear the claim (`step_claim_at = NULL`) in both the success and error branches; the 90 s ceiling auto-expires zombie claims if an edge function dies mid-step.

This eliminates the race across tabs, across the orb advancer + the AIPlansScreen advancer, and across any future invocation path.

### 2. Harden `move_sentence` / `add_sentence`

Two small belt-and-braces fixes in `supabase/functions/plan-step/index.ts`:

- `move_sentence`: if the source sentence is missing, return a clear `{ skipped: true, reason: "source already moved" }` instead of throwing. This makes idempotent retries safe.
- `add_sentence`: replace the hand-rolled "park to negative then restore" two-pass with a call to the existing `insert_sentences_at` Postgres RPC (already in the DB and proven correct). One atomic statement, no intermediate visible state, no chance of conflicting with concurrent shifts on the same doc.

### 3. Drop the duplicate planner watchers

`useRunningPlansAdvancer` runs from the root layout. Confirm it is only mounted once (search for usages) and remove any second mount point if found. This doesn't fix the race on its own, but it removes the easiest way to trigger it from one tab.

## Files to change

- New migration: add `plans.step_claim_at timestamptz` column.
- `supabase/functions/plan-step/index.ts`:
  - Wrap the entry with the atomic claim UPDATE + release.
  - Use the RPC-backed insert in `add_sentence`.
  - Make `move_sentence` idempotent when the source is gone.
- `supabase/functions/plan-compose/index.ts`: short comment documenting that the snapshot is the only cross-request input.
- `src/hooks/use-running-plans-advancer.ts`: verify single mount; no behavior change otherwise.

## Why this resolves the duplicate-key error

The duplicate row could only appear because two executions of the same step both tried to insert at the same `(document_id, order_index)`. With the claim, only one execution can be inside the mutating section at a time, and it always reads `steps` / `current_step` fresh under that claim. The `add_sentence` RPC swap means even a single execution never leaves the table in a half-shifted state, so any pathological future caller can't observe and act on a transient inconsistency.