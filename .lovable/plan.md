## What's actually breaking

I traced the failure to plan `71b46541…` (7-step multi-video plan):
- It got stuck waiting on the very first video (`media_assets 99148d3b…`)
- The plan was marked `failed` at 02:03 with `stalled: media generation made no progress for too long` (after `consecutive_no_progress = 120`)
- That same video actually **completed at 02:23** — 20 minutes *after* the plan had already given up

**Root cause: nothing on the server polls fal.ai for video status.**

- Images use `fal.subscribe(...)` inside the edge function and block until done, so they "just work".
- Videos use fal's queue API (submit → status_url → response_url). The only thing that ever calls `poll-video-job` to drain that queue is the **browser hook** `useVideoJobPolling` running in the user's tab.
- The `plan-step` runner's `awaiting_media` branch only reads the `media_assets` row — it never asks fal what the real status is.
- So whenever the app is closed (or the user is on a different screen long enough), `media.status` stays `generating`, the runner increments `consecutive_no_progress` every tick, and after ~12 min the watchdog kills the plan. The video later finishes successfully and gets stored, but the plan is already dead.

This also explains the "after one video it stops" observation: the first video happens to finish while the app is open (browser polls), the plan advances, the second video starts, the user navigates away or the tab idles, the second video stalls out, plan dies.

## The fix

### 1. Drive fal polling from the server (the real fix)

In `supabase/functions/plan-step/index.ts`, inside the `awaiting_media` branch (around line 1020–1048): before reading the `media_assets` row, if the row is `generating` AND has a `fal_status_url`, invoke `poll-video-job` internally using the existing `invokeEdgeFunction(..., { internal: true, user_id })` pattern. Then re-read the row.

This makes every `plan-tick` cron run (every 10s) actively pump fal's queue for any video the plan is waiting on — no browser required.

### 2. Only count "no progress" when there really is none

Today the counter bumps on every tick the media is still `generating`, even right after submission. Change the awaiting_media branch so:
- The counter resets to 0 whenever the underlying fal queue reports `IN_PROGRESS` with a fresh response (i.e. the poll call we just added succeeded and the vendor is still working) — basically, distinguish "stalled" from "still rendering".
- Track a `media_started_at` on the step when we first enter awaiting_media, and use it for a per-media wall-clock cap (e.g. 25 min) instead of a tick-count cap. Video gens routinely take 8–15 min.

### 3. Bump the timeouts to match reality

In `plan-step/index.ts`:
- Raise `MAX_NO_PROGRESS` from `120` (~12 min at one tick per ~6s) to `300`, so a single slow vendor render can't kill a long plan.
- Leave `MAX_TICKS = 300` and the 2-hour `watchdog_at` as the outer safety nets (they're fine).

### 4. Surface failed/completed plans the user can actually find

The user reported the plan "disappears". Verify `AIPlansScreen.tsx` History tab includes both `failed` and `completed` (it should — but I'll confirm and fix if a filter is dropping `failed` plans without `acknowledged=false`). No DB changes needed.

### 5. Backstop: a media-poll cron

Add a tiny `/api/public/media-poll-tick` route that selects up to N `media_assets` rows with `status='generating'` and `fal_status_url IS NOT NULL` older than 15s, and invokes `poll-video-job` for each. Wire a `pg_cron` job to hit it every 15s.

This is redundant with fix #1 for plan-driven videos but it also rescues **user-initiated** videos (Image-to-Video dialog, etc.) when the user closes the tab mid-generation — same underlying bug class.

## Files touched

- `supabase/functions/plan-step/index.ts` — server-driven poll in `awaiting_media`, smarter no-progress accounting, bigger budget.
- `src/routes/api/public/media-poll-tick.ts` *(new)* — cron-driven media drainer.
- One small SQL `cron.schedule(...)` insert for the new tick route (no migration; data op).
- `src/components/AIPlansScreen.tsx` — confirm/repair History filter so failed plans never disappear.

## Out of scope

- No changes to how plans are composed or to the tool catalog.
- No changes to image generation (it already blocks correctly).
- No client-side hook changes — the browser `useVideoJobPolling` stays as a latency optimization.
