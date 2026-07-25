## Goal

Turn the media gallery into a folder-first experience: opening the gallery shows a vertical list of folders, and media lives inside them. An item can belong to several folders at once (one file, one entry — no storage duplication), and everything that works today keeps working.

## Data model

Two new tables (both user-scoped with RLS + grants):

- `media_folders` — `id`, `user_id`, `name`, `sort_index`, `created_at`, `updated_at`
- `media_folder_items` — `folder_id`, `asset_id`, `added_at`, unique on (folder_id, asset_id), cascade delete

Nothing changes on `media_assets`, so plans, generation edge functions, the media picker, document icons, and polling all keep working untouched. "Unsorted" is a virtual folder = assets with no rows in `media_folder_items`.

## Main view (folders)

Opening `/media` now lands on the folders screen:

```text
┌──────────────────────────────┐
│ ←   Media Gallery      ＋ ⋮  │
├──────────────────────────────┤
│ [ 🗂 All Media        128 ]  │
│ [ 🗂 Unsorted          14 ]  │
│ ──────────────────────────── │
│ [ ▦▦▦  Inspiration     42 ]  │
│ [ ▦▦▦  Client Work     31 ]  │
│ [ ▦▦▦  Voice Notes      9 ]  │
│ ──────────────────────────── │
│ + New folder                 │
└──────────────────────────────┘
```

- Vertically stacked rows, comfortable tap targets, each with a 3-thumbnail preview strip, item count, and a ⋮ menu (Rename, Reorder up/down, Delete folder).
- Deleting a folder never deletes media — it only unfiles it (confirm dialog states this).
- Inline rename via a small dialog, same styling as the existing rename sheet.
- Two pinned rows at top: **All Media** (current behavior, everything) and **Unsorted**.
- Desktop: the same list, capped to a readable max width and centered; two columns at `lg`.

## Inside a folder

Tapping a folder opens the existing grid UI, unchanged in behavior (viewer, long-press sheet, regenerate/remix/i2v/v2v, download-all, multi-select, filter chips, realtime, stuck-item handling). Additions:

- Header shows the folder name with a back arrow to the folders view.
- Filter chips (All/Images/Videos/Audio) now scope within the folder.
- Download-all downloads the folder's contents.

## Moving and duplicating

Multi-select mode gains two actions next to Delete:

- **Move to…** — removes from the current folder, adds to the chosen one.
- **Add to…** — keeps it here *and* adds it to the chosen folder (this is the "duplicate" you asked for: same item, appears in both).

Both open a folder chooser sheet that also has "＋ New folder" inline. The single-item long-press sheet gets the same two actions plus a small row of chips showing which folders the item currently lives in (tap a chip to unfile).

From **All Media** / **Unsorted**, "Move to…" behaves as "file into".

## Where new media lands

Per your answer: if you're inside a folder when you upload or generate, the new item is filed into that folder automatically; otherwise it goes to Unsorted. Uploads file immediately after insert. For generated media (image/video/audio dialogs), the client files the new asset into the active folder once its row id is known; anything created outside the gallery (plans, Orby) stays Unsorted.

## Look and feel

Keeps the current aurora/dark aesthetic and design tokens — no new color literals. Folder rows use the existing rounded card + border treatment, with a gradient fallback tile when a folder has no visual preview yet. Fully touch-friendly on mobile (44px+ targets, safe-area padding preserved) and comfortable on desktop.

## Technical notes

- New migration for the two tables + GRANTs + RLS policies scoped to `auth.uid()`.
- `src/routes/_authenticated/media.tsx` is split: a `MediaFoldersView` component, the existing grid extracted to `MediaGridView`, plus a shared `FolderPickerSheet` component. The route holds which view is active (folder id in route search param so back/refresh works).
- Folder membership fetched as one query keyed `["media_folders"]` / `["media_folder_items"]`, joined client-side against the existing `["media_assets"]` cache — no change to the asset query, so realtime and optimistic updates keep working.
- `MediaGalleryPicker` (used by chat/plans) gets an optional folder filter row later; it keeps working as-is in this change.
