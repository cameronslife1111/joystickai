# Move image generation and editing to GPT Image 2.5

Every place in the app that makes a picture or changes a picture switches to the newer GPT Image 2.5 model. Nothing else changes: the same buttons, the same aspect-ratio and quality choices, the same background generation and gallery behaviour.

## What this covers

- Generate Image (text to image)
- Regenerate an image
- Remix images
- Any planner step that generates or edits an image (these go through the same two backend jobs, so they update automatically)

Upscale and shrink are untouched — they use a different service.

## Technical detail

Two model identifiers change in the backend image jobs:

- `supabase/functions/generate-image/index.ts`: `openai/gpt-image-2` → `openai/gpt-image-2.5/sunburst/text-to-image`
- `supabase/functions/edit-image/index.ts`: `openai/gpt-image-2/edit` → `openai/gpt-image-2.5/sunburst/edit`

The request bodies stay identical — the 2.5 schema accepts the same `prompt`, `image_urls`, `image_size` presets (`square_hd`, `square`, `portrait_4_3`, `portrait_16_9`, `landscape_4_3`, `landscape_16_9`, `auto`), `quality`, `num_images`, and `output_format` fields, so queue submission, the shared poller, and the failed/completed row handling are unchanged. Stale comments that name the old model id (in `edit-image`, `generate-image`, and `plan-step`) get updated wording only.

## Verification

Deploy the two functions, then run one text-to-image generation and one regenerate from the gallery, and confirm both finish and appear as completed images.
