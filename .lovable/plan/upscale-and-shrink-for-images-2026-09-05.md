# Upscale and Shrink for images

Two new options in the three-dot menu when the selected item is an image (they won't show for videos or audio).

## Upscale

Opens a small popup:

- Shows the image thumbnail with its current pixel size.
- Upscale factor slider from 1.5x up to 4x (steps of 0.5), default 2x, with a live "about 3200 x 4800" preview of the result.
- Enhancement strength: Auto (default), Low, Medium, High.
- Face enhancement on/off (on by default).
- Output format: JPEG (default) or PNG.
- Start button.

Behavior: the upscale runs in the background using Topaz Generative Upscale with the Wonder 3.5 model. A new gallery item appears immediately with a "generating" state and the title gets a redo-style suffix (same naming the Regenerate option already uses), so the original image is never overwritten. When it finishes, the upscaled image lands in the gallery like any other generated image. A quick toast confirms it started, and failures show the real reason on the item.

## Shrink

Opens a small popup:

- Shows the current pixel size.
- Size choice: 75%, 50%, 25%, or a custom longest-side value in pixels.
- Live preview of the resulting dimensions.
- Format: keep original (default) or JPEG, plus a JPEG quality slider when JPEG is chosen.
- Shrink button.

Behavior: shrinking happens right on the device, so it's instant and the picture content is completely unchanged — only the dimensions get smaller. It's saved as a new gallery item (title suffixed, e.g. "… (small)"), leaving the original intact.

## Technical notes

**Upscale (background, queue + poll — same pattern as `edit-image`)**

- New edge function `supabase/functions/upscale-image/index.ts`, modeled directly on `edit-image/index.ts`: same dual auth (user JWT or `PLAN_TICK_SECRET` + `user_id`), same `EdgeRuntime.waitUntil` submit to `https://queue.fal.run/topaz/upscale/image/generative`, and it stores `fal_model_id`, `fal_request_id`, `fal_status_url`, `fal_response_url` on the `media_assets` row so the existing `poll-video-job` (already `kind === "image"` aware) downloads, uploads to `joystick-media` and flips the row to `completed`.
- Request body: `{ image_url, model: "Wonder 3.5", upscale_factor, output_format, face_enhancement, enhancement_strength? }`. Validate `upscale_factor` to 1.5–4, `output_format` in `jpeg|png`, `enhancement_strength` in `low|medium|high` (omit for Auto).
- Register `[functions.upscale-image] verify_jwt = false` in `supabase/config.toml`.
- Row insert (client, mirroring `RegenerateImageDialog`): `kind: "image"`, `status: "generating"`, `title: await nextRedoTitle(source.title)`, `generation_params: { mode: "upscale", model: "Wonder 3.5", upscale_factor, output_format, face_enhancement, enhancement_strength, source_asset_id }`. `output_format` in `generation_params` matters — the poller uses it to pick the stored file extension.
- New `src/components/UpscaleImageDialog.tsx`; source image read through `proxyMediaUrl` only for the preview thumbnail, while the raw public `url` is what's sent to fal.

**Shrink (client-side, no backend)**

- New `src/components/ShrinkImageDialog.tsx`: fetch the image through `proxyMediaUrl`, draw to a canvas at the target size (`createImageBitmap` + `canvas.toBlob`), upload the blob to the `joystick-media` bucket at `${user.id}/${Date.now()}_shrunk.<ext>` with `supabase.storage.from(BUCKET).upload`, then insert a `media_assets` row with `status: "completed"`, the public URL, `width`/`height`, `mime_type`, `storage_path`, and `generation_params: { mode: "shrink", source_asset_id, scale }`.
- Multi-step downscale (halving passes before the final draw) so large reductions stay smooth rather than aliased.

**Menu wiring**

- `src/routes/_authenticated/media.tsx`: two `SheetButton`s guarded by `sheetAsset.kind === "image"`, placed after Remix — `Upscale` (ArrowUpNarrowWide icon) and `Shrink` (Minimize2 icon) — each closing the sheet and setting new `upscaleAsset` / `shrinkAsset` state, plus rendering the two dialogs alongside the existing `RegenerateImageDialog` / `RemixImagesDialog`.
- Both dialogs invalidate `["media_assets"]` on submit so the gallery updates right away.
