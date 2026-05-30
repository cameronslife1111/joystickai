## Goal

Keep the whole plan flow exactly as it is — the approval dialog still pops up, the toasts still fire — but remove the manual "Approve and Run" tap. As soon as Orby finishes composing a plan and it becomes a real proposal (status `proposed` with at least one step), it auto-approves and starts running.

## Where the change lives

`src/components/PlanApprovalDialog.tsx`. This dialog already polls/subscribes to the plan and already contains the exact `approve()` logic (set status to `approved`, invoke `plan-step`, invalidate queries, show the "Running in the background" toast, call `onApproved`). It's used by both `app.tsx` and `AIPlansScreen.tsx`, so changing it here covers every entry point.

## What changes

Add a one-shot auto-approve effect inside `PlanApprovalDialog`:

- Track whether we've already auto-approved this plan with a `useRef` keyed off `planId` (so re-renders, polling, and realtime updates don't fire it twice).
- In a `useEffect` watching `plan?.status` and the steps, when `open` is true and `status === "proposed"` and `steps.length > 0` and we haven't auto-approved this plan yet, call the existing `approve()` function automatically.
- Reset the "already approved" ref whenever `planId` changes.

Everything else stays untouched:
- The dialog still opens and shows "Planning…" while composing.
- `refused` (proposed with 0 steps) and `failed` plans do NOT auto-approve — they keep showing their message and the Close button, exactly as today.
- The "Approve and Run" button can stay in the markup as a harmless fallback (it just won't normally be reached), or be left as-is.
- The "Running in the background — safe to close the app" toast and the composer's "Orby is planning…" toast both still fire, so you still get the toaster notifications when a plan starts.

## Technical notes

- No backend, edge function, or schema changes. The same `plans` status transition (`proposed` → `approved`) and the same `plan-step` invocation are used; we're just triggering them automatically instead of on a button press.
- Guarding with a per-`planId` ref prevents duplicate `plan-step` invocations from the polling interval and the realtime subscription both updating the cache.
