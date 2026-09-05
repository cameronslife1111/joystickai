# Let plans upscale and shrink images

Orby's multi-step planner gets two new image abilities, sitting alongside the existing image ones (create / redo / remix). They turn on and off with the same **Image generation** toggle in chat, so nothing new to switch on.

## What you'll be able to ask for

- "Upscale that sunset picture 4x" — a step that sends the picture through the same Wonder 3.5 upscaler the three-dot menu uses, in the background, and saves the bigger copy as a new gallery item.
- "Make a small version of these three images" — a step that shrinks a picture's dimensions without changing the picture itself, saved as a new gallery item.
- Chains work too: "make an image of a red barn, upscale it 2x, then shrink a copy to half size" runs as one plan, each step waiting for the previous one.

Originals are never touched or overwritten, and both steps report the new item back to chat like every other media step.

## Behavior details

- **Upscale**: factor between 1.5 and 4 (defaults to 2), optional enhancement strength and face enhancement, JPEG or PNG output. Runs on the background job queue; the plan waits for it exactly like image generation and video steps do, including the existing timeout and failure reporting.
- **Shrink**: either a percentage (default 50%) or a target longest side in pixels. Finishes in seconds, keeps the same picture content, and only ever makes it smaller (never upsizes).
- Both refuse anything that isn't an image, with a clear message in the plan step.
- Titles follow the existing naming pattern so the new items are easy to spot in the gallery.

## Technical notes

- `supabase/functions/_shared/tools.ts`: add `upscale_image` and `shrink_image` to `TOOL_CATALOG` with arg descriptions, and map both to the `image_generation` group in `TOOL_GROUPS` so the existing capability toggle governs them.
- `supabase/functions/plan-step/index.ts`:
  - `upscale_image` handler — `_load_media(..., "image")`, clamp `upscale_factor` to 1.5–4, insert a `generating` `media_assets` row with `generation_params: { mode: "upscale", model: "Wonder 3.5", upscale_factor, output_format, face_enhancement, enhancement_strength, source_asset_id, origin: "plan" }`, POST to `https://queue.fal.run/topaz/upscale/image/generative` with `Authorization: Key ${FAL_KEY}`, store `fal_model_id` / `fal_request_id` / `fal_status_url` / `fal_response_url`, return `{ __pending_media: row.id }`. The existing `awaiting_media` branch plus `poll-video-job` (whose `extractImage` already covers this model's response shape) finish the job — no poller changes.
  - `shrink_image` handler — download the source, decode/resize/encode with ImageScript (`https://deno.land/x/imagescript`, pure WASM, works in edge functions), guard against upsizing, cap source size, upload to `joystick-media` under `${user_id}/${Date.now()}_shrunk.<ext>`, insert a `completed` row with `generation_params: { mode: "shrink", source_asset_id, target_width, target_height, origin: "plan" }`, and return the new asset id/title synchronously (no queue wait).
  - Add `upscale_image: ["source_media_id"]` and `shrink_image: ["source_media_id"]` to `validateExpansionSteps`' `REQUIRED` map, and mention the two tools in the MEDIA MATCHING planner guidance line so the composer picks them.
- `supabase/functions/plan-compose/index.ts` needs no change — it reads the shared catalog.
- No changes to the existing three-dot-menu upscale/shrink paths, the client dialogs, or any other tool.
