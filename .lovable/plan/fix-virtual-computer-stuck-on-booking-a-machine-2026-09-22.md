# Fix: virtual computer stuck on "Booking a machine…"

I found the cause in your own run history. The most recent attempt (23:29) sat with zero steps and no machine ever booked, until you pressed Stop. It isn't TypeSafe and it isn't Browser Use — nothing in the app ever tells a freshly queued errand to actually go book the browser.

## What's happening

A new errand is written down as "starting — Booking a machine…". From then on, the card and the background tick both ask the same question: "push this errand forward". That pusher sees the errand is in fast mode and hands it to the fast driver, which then refuses to do anything because the errand isn't marked "running" yet — and only the booking step marks it running. So it waits on itself forever.

Runs that worked earlier were booked directly during my testing, which is why fast mode itself is fine: the browser, TypeSafe decisions, clicking and typing all work once booking happens.

## The fix

1. When a run is pushed forward and no machine exists yet, book one instead of returning silently — both in the fast driver and in the general pusher, so neither can dead-end.
2. Give every newly queued errand its own deadline at queue time (the planner's queue path currently omits it), so the runaway guard is always armed even if booking is delayed.
3. Make a failed booking visible: if the browser service refuses, the errand hands over to the slower careful robot (as designed today), and if that also fails the card says plainly what blocked it rather than sitting on "Booking a machine…".
4. Add a stall guard: an errand still un-booked after about 90 seconds is failed with a plain message instead of hanging.

## Technical detail

- `src/lib/vc-reflex.server.ts` — `reflexTick` currently early-returns for any `status !== "running"`. Allow `starting`/queued rows with no `cdp_url` to fall through to `startReflexRun`.
- `src/lib/vc.server.ts` — in `pollVcRun`, route `status === "starting"` to `startVcRun` before the reflex branch; keep `awaiting_secret` and terminal handling unchanged. `queueVcRun` already sets `deadline_at`; `startVcRun`/`startReflexRun` reset it on booking.
- `supabase/functions/plan-step/index.ts` (`virtual_computer_task`) — include `deadline_at` on the insert so plan-created runs are bounded from the moment they're queued.
- Add the un-booked stall check (created_at age with no `browser_id`) inside `pollVcRun` so both the card poke and the 5-minute plan tick enforce it.
- No schema change, no new secrets, no change to the credential locked-box path or escalation.

## Verification

Start a real errand from chat with fast mode on and watch the card move from "Booking a machine…" to "Opening the browser…" and then through live steps; confirm the live window appears and the machine is shut down at the end; confirm a deliberately bad start URL ends with a plain message instead of hanging.
