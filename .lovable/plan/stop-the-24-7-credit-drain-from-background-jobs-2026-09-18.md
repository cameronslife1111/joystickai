# Stop the 24/7 credit drain from background jobs

## What's running now

Five repeating background jobs live in the database and fire around the clock, even when nobody has the app open:

| Job | How often | What it does |
| --- | --- | --- |
| plan tick | every 10 seconds | pushes running plans one step forward |
| media poll | every 15 seconds | checks if videos finished generating |
| chat turn rescue | every 20 seconds | finishes replies whose phone/tab went away |
| scheduled plans | every minute | fires plans you scheduled for a time |
| orchestrator | every 5 minutes | leftover job pointing at an endpoint that no longer exists |

Together that's roughly 20,000 wake-ups a day, which never lets the database go idle. That idle-time compute is the charge.

## What I'll change

1. Delete all five jobs.
2. Create one single job that runs **every 5 minutes** and does all the real work in one pass: fire any plans you scheduled for a time, move running plans forward, rescue unfinished replies, and check on generating videos.
3. Delete the dead orchestrator job entirely (its endpoint doesn't exist).

Nothing is removed from the app itself. While the app is open, it already pushes plans, replies and videos along every few seconds on its own — so day-to-day use feels exactly the same as today.

## What changes for you

- Scheduled plans still work. A plan set for 9:00 starts within about 5 minutes of 9:00 instead of within a minute.
- A plan left running with the app fully closed advances every 5 minutes instead of every 10 seconds. Reopen the app and it speeds straight back up.
- Everything with the app open: unchanged.

## Data safety

No tables, rows, documents, chats, media or settings are touched. This only changes the database's job timetable.

## Technical details

- `cron.unschedule` for `orby-plan-tick`, `media-poll-tick-15s`, `orby-chat-turn-tick`, `orby-plan-scheduler-tick`, `orby-orchestrator-tick`.
- New job `orby-maintenance-tick` on `*/5 * * * *` calling `POST /api/public/plan-scheduler-tick` (already fires due schedules and `runStaleChatTurns`).
- Extend that route to also chain `plan-tick` and `media-poll-tick` work in the same request, so one wake-up covers all four responsibilities instead of four separate crons.
- Run via `run_sql` (contains project URL + anon key), not a migration.
- Client-side advancers (`use-running-plans-advancer`, `use-composing-plans-watcher`, `use-video-job-polling`) stay untouched — they keep the foreground experience instant.

## Afterwards

I'll list exactly which jobs were removed, what the one remaining job does, and how to set a plan's schedule.
