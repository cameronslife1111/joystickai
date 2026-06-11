# Fix: old media leaking into freshly-run scheduled plans

## What's actually happening

The "Run now" button (`runScheduleNow` in `src/lib/plan-schedules.functions.ts`) creates a brand-new `plans` row in status `composing` and invokes the `plan-compose` edge function. That part is clean — it copies only the schedule's `user_request` and `attached_document_ids`, nothing else.

The leak is inside **`supabase/functions/plan-compose/index.ts`**, in how it builds the `MEDIA` section of the WORKSPACE SNAPSHOT that gets handed to the planner LLM:

```text
src/lib/plan-schedules.functions.ts  runScheduleNow → insert plan → invoke plan-compose
                                          │  (only user_request + attached_document_ids carried) ✅
                                          ▼
supabase/functions/plan-compose/index.ts  builds MEDIA snapshot from ALL of user's media ❌
                                          ▼
                                       planner reuses old media ids → regenerate_image / remix etc.
```

Two specific code paths cause it:

1. **Media fallback dumps the whole library (lines 333–334).**
   ```ts
   const relevantMedia = mediaScored.filter(({ score }) => score > 0).map(({ m }) => m);
   const mediaSource = relevantMedia.length > 0 ? relevantMedia : (allMedia ?? []);
   ```
   When the request doesn't token-match any media, it falls back to the 25 most-recent assets — almost all leftover output from prior plans — and lists them as reusable candidates.

2. **Repeated schedules self-match their own prior output (line 333, the `score > 0` filter).**
   A schedule like "generate a cat image" produces media whose title/`source_text` contains "cat". On the next run the same word "cat" token-matches that prior asset, so it's surfaced in the MEDIA list, and the planner picks `regenerate_image` / `remix_images` on the old id instead of generating something fresh. This is exactly why the problem shows up on repeated/scheduled runs specifically.

The DOCUMENT side already has a strict `strongDocMatch` guard (lines 241–261); MEDIA never got the equivalent tightening.

## The fix

Edit only `supabase/functions/plan-compose/index.ts` (no schema, no UI, no behavior change to one-off plans that genuinely reference existing media):

1. **Remove the whole-library fallback.** Drop the `: (allMedia ?? [])` fallback so an unmatched request yields an empty MEDIA list instead of the recent-output dump.

2. **Detect "reuse intent" vs "create-fresh intent".** Add a small check on `reqLower` for words that imply operating on existing media (e.g. regenerate, remix, edit, "this/that image", animate, "turn … into a video", "the … photo/image/clip"). Only when reuse intent is present (or a document/media is explicitly attached) should prior media be surfaced as candidates.

3. **Apply strong matching to media, mirroring docs.** When reuse intent exists, require a genuine match (phrase/substring hit or 2+ distinct meaningful tokens against title + `source_text`) before listing an asset — replacing the loose `score > 0`. A pure "generate a cat image" request will then surface nothing to reuse and the planner will use `generate_image` fresh.

4. **Keep attachments and explicit references working.** Forced `attached_document_ids` and `find_media_by_title` (used only when the planner truly needs an existing asset) remain available, so legitimately referencing existing media still works.

## Verification

- Redeploy `plan-compose`.
- Run a scheduled plan whose request only says to generate new media; confirm via edge-function logs / the resulting steps that no `regenerate_image` / `remix_images` step targets a pre-existing media id and that `generate_image` is used instead.
- Run a plan that explicitly says "regenerate the cat image" to confirm reuse still works when intended.
- Run it twice in a row to confirm the second run does not pick up the first run's output.

## Technical notes

- Changes are confined to the snapshot-building block (≈ lines 312–364) of `plan-compose/index.ts`; the system prompt's FRESH-PLAN ISOLATION rule already tells the planner to treat lists as lookup-only — this change stops the offending items from being put in front of it in the first place.
- No changes to `runScheduleNow`, `plan-scheduler-tick`, `plan-step`, or any table — the carried fields were already minimal and correct.
