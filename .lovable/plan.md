## Goal
Let you long-press a tile that's stuck showing "Generating..." in the Media Gallery to stop and remove it, freeing the gallery when FAL has actually finished but the row never flipped to completed.

## Current behavior
In `src/routes/_authenticated/media.tsx`, generating tiles are inert: `onClick` returns early when `isGenerating`, and `onContextMenu` (long-press / right-click) also returns early for generating items. So there's no way to act on a stuck row.

## Changes (frontend only, `src/routes/_authenticated/media.tsx`)

1. **Long-press detection on generating tiles**
   - Add `onTouchStart`/`onTouchEnd` (and keep `onContextMenu` for desktop) timers on the grid `button`. After ~500ms hold on a tile where `isGenerating` is true, open a small confirmation sheet.
   - Cancel the timer on touch move/end so a normal tap still does nothing (tap stays inert for generating tiles, as today).

2. **"Stuck generation" action sheet**
   - Add a new state (e.g. `stuckAsset`) and a bottom sheet that appears on long-press of a generating tile.
   - Sheet shows the title and a single destructive action: **"Stop & delete"**, plus Cancel.
   - Confirming calls the existing `deleteAsset(a)` logic, which removes the `media_assets` row (and its storage file if any) and refreshes the gallery.

3. **Why this stops the generation**
   - The background poller (`poll-video-job`) only updates rows that still exist and reads them by id. Deleting the row means nothing will be written back, so the spinner disappears permanently and no further work targets that asset. No backend changes are required.

## Out of scope
- No edge function or database changes. Deleting the row is sufficient to clear the stuck state; the FAL job (already finished in your case) is simply abandoned.
