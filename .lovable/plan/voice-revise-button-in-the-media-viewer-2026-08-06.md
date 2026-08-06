# Voice Revise button in the media viewer

## Goal
While previewing an image or video, tap a red circle, say what you want changed, tap the black square, and the item is regenerated with a rewritten prompt reusing the same source/reference images and settings. The viewer then returns to the gallery.

## Behavior

1. A red circle button appears in the viewer chrome (bottom row, left of the options button) for images and videos that finished generating.
2. Tap it: the mic starts recording and the button becomes a black square with a subtle pulse.
3. Tap the black square: audio is transcribed with the existing Whisper dictation flow.
4. The transcript plus the original prompt is sent to the AI to produce one rewritten image/video prompt (plain text, no commentary).
5. A new media row is created and the correct generation is kicked off:
   - image made by generate/regenerate/remix -> `edit-image` with the same reference image URLs (the previewed image, or the original `source_asset_ids` when present) and the same aspect ratio / quality.
   - video made by image-to-video, video-to-video, or audio+image-to-video -> the same edge function with the same source asset URL and the same duration / resolution / aspect / negative-prompt settings.
   - an image with no usable reference falls back to a fresh `generate-image` call.
6. The viewer closes back to the gallery, a toast confirms it started, and the new item shows the usual "Generating..." state.
7. Anything unexpected (no speech heard, missing source URL, unknown generation mode) shows an error toast and leaves the viewer open.

## Technical notes

- New component `src/components/VoiceReviseButton.tsx` handling the red-circle / black-square states via the existing `useVoiceDictation` hook, taking the current asset and an `onDone` callback.
- Prompt rewriting uses the existing `generateText` server function in `src/lib/ai.functions.ts` with a short instruction: combine the original prompt with the requested change and return only the new prompt.
- Original prompt and settings come from `media_assets.generation_params` (`user_text`, `image_size`, `quality`, `source_asset_id` / `source_asset_ids`, video params), which is already populated by every generation dialog.
- New rows record `generation_params.mode` of the reused pipeline plus `revised_from_asset_id` and the spoken `revision_text`, so history is traceable.
- Reference image URLs are resolved by reading the source assets' `url` from `media_assets`; media URLs keep using `proxyMediaUrl` only for display, raw URLs go to the edge functions.
- Rendered inside the existing viewer chrome block in `src/routes/_authenticated/media.tsx`; clicks stop propagation so the tap-to-advance zones aren't triggered.
- No schema changes, no edge function changes.
