# Organized "redo" titles for revised and remixed media

Right now a voice-revised or remixed image gets titled from the spoken/typed prompt, which makes the gallery hard to scan. Instead, new media should inherit the source item's title with a "redo" counter.

## Behavior

- Voice revise (red circle in the media viewer): the new item is titled `<original title> redo 1`.
- Press again on that result: `<original title> redo 2`, then `redo 3`, and so on — the counter keeps climbing from the original base title, never stacking ("Sunset redo 1 redo 1" won't happen).
- Remix (3 dots → Remix): same rule, based on the title of the image the remix started from.
- Regenerate from a single image (3 dots → Regenerate) follows the same rule so titles stay consistent.
- Videos revised with the red circle get the same treatment.
- Renaming an item later is untouched; future redos of a renamed item use the new name as the base.

## Technical notes

- New helper `src/lib/redo-title.ts`:
  - `baseTitle(t)` strips a trailing ` redo <n>` (case-insensitive) so the base never accumulates.
  - `nextRedoTitle(base)` queries the signed-in user's `media_assets` titles with `ilike '<base> redo %'`, takes the highest trailing number, and returns `<base> redo <max+1>` (starting at 1). Falls back to `<base> redo 1` on query error.
- Use it in place of the current `prompt.slice(0, 60)` titles in:
  - `src/components/VoiceReviseButton.tsx` (`insertRow`, images and all video modes) — base from `asset.title`.
  - `src/components/RemixImagesDialog.tsx` — base from `initialAsset.title`.
  - `src/components/RegenerateImageDialog.tsx` — base from `sourceAsset.title`.
- The prompt itself still drives generation and is kept in `generation_params.user_text`; only the display title changes.
