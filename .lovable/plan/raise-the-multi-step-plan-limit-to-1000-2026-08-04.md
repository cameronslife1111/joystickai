# Raise the multi-step plan limit to 1000

## What you hit

The message you saw ("...300...") comes from a safety cap in the plan runner: a plan is allowed 300 server ticks (one tick ≈ one step advance or one media poll) before it is force-failed with `tick_limit_exceeded`. Long plans with many images/videos can burn through that.

## What changes

- Raise the tick cap from 300 to 1000, so a plan can take up to ~1000 advances before the safety net trips. The failure message updates to reflect the new number.
- Raise the runtime-expansion cap (how many sub-steps one "do this for each item" step can generate) from 120 to 400, so long runtime loops aren't silently truncated at 120 items.
- Leave the stall detector and the per-media 30-minute wall-clock cap alone — those catch genuinely stuck media, not long plans, and loosening them would let a broken generation hang forever.

Since you can stop a running plan from the AI Plans screen, the higher ceiling stays under your control.

## Technical detail

In `supabase/functions/plan-step/index.ts`:

- `MAX_TICKS`: `300` → `1000`
- `MAX_EXPANSION_STEPS`: `120` → `400`

No schema change, no UI change, no other logic touched. `consecutive_no_progress` / `MAX_NO_PROGRESS` (300) and `MAX_MEDIA_WAIT_MS` (30 min) stay as-is.
