# Make the voice revise button remix the image you're viewing

## Goal
When you tap the red circle on an image, say what to change, and tap the black square, the app should **remix the image you're looking at** — not regenerate a fresh image from text. Your face/character references stay in the mix so likeness is preserved.

## What changes

1. Images always go through the remix (image edit) path.
   - The image currently previewed is always the **first** reference.
   - Any reference images from the original generation (`source_asset_ids`, or a single `source_asset_id`) are added after it, de-duplicated, capped at 16.
   - The text-only fallback only happens if the previewed image has no usable URL at all (rare); otherwise it never regenerates from scratch.

2. The prompt is rewritten as an **edit instruction**, not a full new prompt.
   - New rewriting mode for images: the model receives the original prompt (for context only) plus the spoken request, and returns a short, concrete instruction describing the change to apply to the attached image (e.g. "Change the jacket to red leather and put her on a rainy city street at night; keep the same face, hair, pose and lighting").
   - Rules baked into the instruction: preserve identity/face/composition unless the user asked to change them, describe only what changes plus what must stay, no commentary, no quotes, plain text.
   - Aspect ratio and quality are inherited from the original image's settings.

3. Videos are unchanged — they keep the existing behavior (full prompt rewrite, same source media and settings).

4. Feedback stays the same: toast confirms the remix started, the viewer closes to the gallery, the new item shows "Generating…".

## Technical notes

- `src/lib/media-revise.functions.ts`: add a `mode` (`"edit"` for images vs `"video"`) to the input and branch the system prompt. Image mode returns an edit instruction; video mode keeps today's full-prompt rewrite.
- `src/components/VoiceReviseButton.tsx`: in the image branch, build `image_urls` as `[currentAssetUrl, ...resolvedReferenceUrls]` (unique, ≤16) and always call the `edit-image` function; keep `image_size` / `quality` from `generation_params`.
- New row's `generation_params` records `mode: "voice-remix"`, `source_asset_ids` (the URLs' asset ids), `revised_from_asset_id`, and `revision_text`, so a later voice revise on the result also keeps the references.
- No schema changes, no edge function changes.
