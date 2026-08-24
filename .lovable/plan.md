# Add "Attach Image titles" to chat + rename "Attach images"

## What you'll see

In the chat's settings popover (the gear icon), directly under the **Read replies aloud** toggle:

1. The existing **Attach images** button is renamed to **Attach Image to Analyze** — same behavior as today (picked images get analyzed by Orby).
2. A new button above it: **Attach Image titles**. It opens a media gallery sheet showing your images *with their titles visible on each tile*. Tap one or more images, press Done, and their titles are typed into the message box for you — comma-separated ("Sunset sketch, Logo v2, Birthday idea") — inserted exactly where your cursor was, as if you typed them yourself. You can then keep typing or edit them freely.

From that same sheet you can also manage your images without leaving the chat:

- **Rename**: each tile gets a small pencil button that opens the same in-app rename dialog used in the media gallery (pre-filled title, Enter saves, Escape cancels). The new title is saved and the sheet refreshes.
- **View**: each tile gets a small expand button that opens the image full-screen with its title, so you can check which image a title belongs to before selecting it.

## How it works technically

- **`src/components/MediaGalleryPicker.tsx`** — add optional props: `showTitles` (render each asset's title on its tile), `allowManage` (show pencil + expand buttons per tile), and `heading` (custom sheet title, e.g. "Attach Image titles"). Rename uses an in-app dialog mirroring the one in `media.tsx`, updating `media_assets.title` via the existing supabase client and invalidating the `["media_assets_picker"]` query so titles refresh. The full-screen view is a simple overlay inside the sheet. Existing callers (Attach Image to Analyze, video pickers, etc.) are unaffected since the new props are opt-in.
- **`src/components/ChatDialog.tsx`** —
  - Rename the "Attach images" button label to "Attach Image to Analyze".
  - Add the "Attach Image titles" button above it, opening a second `MediaGalleryPicker` instance (`kind="image"`, multi-select, `showTitles`, `allowManage`).
  - Track the textarea cursor position in a ref (via the textarea's `onSelect` event, which fires on tap/typing/arrow keys) so the position survives the sheet opening.
  - On Done: join the selected titles with `", "`, splice them into the input at the saved cursor position (with a space added before/after only if needed so words don't fuse), refocus the textarea, and place the cursor right after the inserted titles.
- No database or backend changes — `media_assets.title` already exists and rename reuses the current update path.

## Edge cases

- No images in the gallery: sheet shows the existing empty state.
- Renaming an image that's already selected keeps it selected; the title shown updates after save.
- Titles are plain text once inserted — deleting or editing them in the message box never touches the actual image titles.
