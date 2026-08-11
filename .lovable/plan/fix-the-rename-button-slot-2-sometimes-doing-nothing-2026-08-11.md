# Fix the Rename button (slot 2) sometimes doing nothing

## What's happening

The Rename button uses the browser's built-in `prompt()` popup to ask for the new title (`src/routes/_authenticated/app.tsx:2254`). Browsers are allowed to silently ignore these built-in popups — most commonly on mobile/installed web apps, inside embedded previews, or once a page has shown a few of them in a row ("prevent this page from creating more dialogs"). When that happens the call instantly returns "nothing", so the code exits and it looks like the button is dead. A reload resets that browser state, which matches exactly what you're seeing.

The same applies to New doc (also `prompt`) and Delete doc (`confirm`).

## The fix

Replace the built-in browser popups with the app's own in-app dialogs, styled like the other Orby sheets:

- **Rename**: opens a small dialog pre-filled with the current title, with a text field, Cancel and Save. Enter saves, Escape cancels. Saving updates the title and refreshes the document list, same as today.
- **New doc**: same dialog pattern, empty field, defaults to "Untitled" if left blank.
- **Delete doc**: a confirm sheet with the document title and a red Delete button, replacing the native confirm.

These are always rendered by the app itself, so they cannot be blocked or suppressed by the browser — the button will work every time, with no reload needed.

## Technical notes

- In `src/routes/_authenticated/app.tsx`, add local state for `renameOpen` / `renameText`, `newDocOpen` / `newDocText`, and `deleteDocOpen`.
- Menu slot handlers close the menu and open the matching dialog instead of calling `prompt`/`confirm`.
- Move the existing Supabase update/insert/delete logic into submit handlers; keep the current `qc.invalidateQueries(["documents"])` calls, favorites pruning on delete, and `setActiveDocId` on create.
- Reuse the existing overlay/dialog markup style already used elsewhere (e.g. the media rename dialog) so it matches the app's look.
- No database or backend changes.
