## Multi-select batch delete in Media Gallery

Add a toggleable multi-select mode to `src/routes/_authenticated/media.tsx` so users can pick many assets at once and delete them in one action, with storage files reliably removed.

### UI changes (media.tsx header)

- Add a new circular icon button at the **far left of the header**, immediately to the left of the "Media Gallery" title (after the Back button). Uses a `CheckSquare` icon (lucide-react). Tapping toggles `selectMode`.
- When `selectMode` is on:
  - The title swaps to "N selected".
  - The right-side header actions (Download all, Upload +) are replaced by:
    - A red "Delete" button (disabled if selection is empty) showing a `Trash2` icon + count.
    - A "Cancel" / X button that exits select mode and clears the selection.
  - Filter chips remain visible so the user can scope selections to images/videos/audio.

### Grid behavior

- New state: `selectMode: boolean`, `selectedIds: Set<string>`.
- In select mode, tapping a tile toggles its membership in `selectedIds` (no preview open, no asset sheet). Selected tiles get a checked overlay (filled circle in the corner + ring around the tile).
- Long-press / asset-menu sheet is disabled while in select mode.
- Add a "Select all (visible)" / "Clear" toggle just under the filter chips while in select mode — operates on the currently filtered list.
- Exiting select mode (Cancel, successful delete, or navigating away) clears `selectedIds`.

### Batch delete logic

Reuse the existing single-delete pathway so behavior stays consistent:

1. Confirm via a small inline confirmation ("Delete N items? This can't be undone.") with Cancel / Delete buttons.
2. Collect selected `Asset` rows from the current query cache.
3. **Storage cleanup first, in one call**: `supabase.storage.from("joystick-media").remove(paths)` where `paths` is every non-null `storage_path` of the selected assets (Supabase accepts an array — one round trip, not N).
4. **Database cleanup**: `supabase.from("media_assets").delete().in("id", selectedIds)`.
5. If storage removal returns a partial error, still proceed with DB delete for the rows whose storage succeeded; surface a toast like "Deleted N items (M storage files could not be removed)" so nothing is silently orphaned.
6. On success: toast "Deleted N items", invalidate the media query, exit select mode.

### Storage backlog safety

- The single `storage.remove(paths[])` call ensures every selected asset's blob is targeted, matching what the per-asset `deleteAsset` does today (`storage_path` is the canonical key already used on insert at line 241).
- Assets with `status !== "completed"` (still generating) are allowed to be selected too — they often have a `storage_path` reserved; the same remove call handles them and prevents orphan files from failed/in-flight generations.
- No schema or RLS changes: existing `own media_assets delete` policy already covers `.in("id", ...)` deletes for the user's own rows, and `joystick-media` bucket policies already allow owners to remove their objects.

### Out of scope

- No new tables, edge functions, or migrations.
- Single-asset delete flow (asset sheet) and Download All flow remain untouched.
- No change to plan/runner code or any other route.
