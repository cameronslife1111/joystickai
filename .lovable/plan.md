# Slow the maintenance tick from 5 to 15 minutes

## Current state (verified)

One recurring job remains in the database:

- `orby-maintenance-tick` — schedule `*/5 * * * *`, active, posting to `https://orbyai.lovable.app/api/public/plan-scheduler-tick`

At every 5 minutes that is 288 database wake-ups per day. At 15 minutes it becomes 96 per day — a two-thirds cut in that idle-time compute charge.

## What changes

1. Unschedule `orby-maintenance-tick`.
2. Re-create it on `*/15 * * * *` — same endpoint, same headers, same empty body.
3. Verify by reading `cron.job` and confirming exactly one active job on the 15-minute schedule.

No tables, rows, documents, chats, media, or app code are touched. This only changes the job's timetable.

## What changes for you

- Scheduled plans fire within about 15 minutes of their set time instead of 5.
- A plan left running with the app fully closed advances every 15 minutes instead of every 5. Opening the app speeds it straight back up.
- Everything while the app is open: unchanged.

## Technical details

- Run via `run_sql` (the command contains the project URL and key), not a migration.
- SQL: `cron.unschedule('orby-maintenance-tick')`, then `cron.schedule('orby-maintenance-tick', '*/15 * * * *', $$ select net.http_post(url := 'https://orbyai.lovable.app/api/public/plan-scheduler-tick', headers := '{"Content-Type":"application/json","apikey":"<anon key>"}'::jsonb, body := '{}'::jsonb); $$)`.
- 15-minute cadence is sub-hourly (96 runs/day) — job kept because it is the app's only background job: it fires scheduled plans, advances stuck plans, rescues unfinished chat replies, and polls video generation when the app is closed.
- No app-code edits needed; the tick route already chains all four responsibilities in one request.
