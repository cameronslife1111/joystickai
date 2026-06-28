## Goal
Fix two media bugs without disturbing the working paths:
1. Remixed/generated images get stuck "generating" forever even though FAL finished.
2. Image→Video / Video→Video shows a false "didn't start" error while the video actually generates.

The fix unifies images onto the same resilient queue+poll pattern videos already use, and makes video submission non-blocking so the client never times out.

---

## Fix 1 — Images stuck "generating" (the core bug)

Today `edit-image` and `generate-image` run the FAL job inside `EdgeRuntime.waitUntil` with `fal.subscribe`, writing the result directly. If that background worker is cut off before the DB write, the row is orphaned in `generating` with no recovery (images store no `fal_status_url`, so no poller ever touches them).

Switch both image functions to FAL's **queue** pattern, exactly like `generate-kling-video`:
- Submit to `https://queue.fal.run/<model>` (`openai/gpt-image-2` for generate, `openai/gpt-image-2/edit` for remix), keeping the same retry/backoff behavior `generate-image` already has for transient 5xx.
- On a successful submit, write `fal_status_url`, `fal_response_url`, `fal_request_id`, `fal_model_id` onto the row and return immediately.
- On submit failure, mark the row `failed` with the extracted FAL error (preserve the existing detailed error extraction).
- Stop doing the long download/upload/DB-write inside `waitUntil`.

Make the existing poller `poll-video-job` **kind-aware** so it can finish image jobs (it already selects `kind` and already guards on `status === "generating"` + both FAL URLs):
- If `row.kind === "image"`: pull the image URL from the FAL result (`result.images?.[0]` / `result.data?.images?.[0]`), download it, upload as `..._generated.<ext>` with the correct image mime, and update the row to `completed` with `url`/`storage_path`/`width`/`height`/`size_bytes`.
- Keep the existing video branch unchanged.
- Use `generation_params.output_format` (fallback `png`) for the extension/mime.

No client changes needed for recovery: `use-video-job-polling.ts` and `api/public/media-poll-tick.ts` already query `generating` rows with a non-null `fal_status_url` and **no** `kind` filter, so images will be polled automatically (foreground while the gallery is open, backstop otherwise). The gallery's realtime subscription already flips the thumbnail to completed.

Net effect: an image job now survives a worker getting cut off — the poller drives it to completion (or `failed`) instead of spinning forever.

---

## Fix 2 — Video shows error but still starts

`generate-kling-video` does its slow work (re-hosting source image/video to FAL via `hostOnFal`, then queue submit) synchronously before returning, so the client `functions.invoke` call times out and throws a false error even though the server succeeded.

Make submission non-blocking:
- Validate inputs and return `{ ok: true }` (202-style) immediately.
- Move `hostOnFal(...)` + queue submit + writing `fal_status_url`/`fal_response_url` into `EdgeRuntime.waitUntil`.
- On any failure in that background block, mark the row `failed` with the error (so the gallery shows a real failed state instead of a phantom error toast).

Because the row is created `generating` before invoke and is completed by the existing pollers, the client no longer needs to wait — it just shows "Generating…". The false "didn't start" toast disappears; genuine submit failures surface as a `failed` tile in the gallery.

No client dialog changes required, but I'll verify `ImageToVideoDialog` / `VideoToVideoDialog` error handling still reads sensibly with the fast return (they already just toast a generic start message on success).

---

## Files touched
- `supabase/functions/edit-image/index.ts` — switch to FAL queue submit; store status URLs; remove in-`waitUntil` completion.
- `supabase/functions/generate-image/index.ts` — same switch (keep transient-error retry around the submit).
- `supabase/functions/poll-video-job/index.ts` — add image-completion branch alongside the existing video branch.
- `supabase/functions/generate-kling-video/index.ts` — move re-host + submit into `EdgeRuntime.waitUntil`, return immediately.

## Deploy & verify
- Deploy the four edge functions.
- Remix an image and a from-scratch generate; confirm the row gains `fal_status_url`, then flips to `completed` in the gallery.
- Run Image→Video and Video→Video; confirm no error toast appears and the video completes.
- Confirm a deliberately bad input still ends as a `failed` tile (not stuck spinning).

## Safety notes
- The video path's polling/storage logic is reused untouched; the image branch is additive.
- No DB schema, RLS, or client routing changes.
- Existing detailed FAL error extraction is preserved so failures stay debuggable.