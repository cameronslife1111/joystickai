# Download Selected Items in Media Gallery

## Goal
While in multi-select mode in the media gallery, let the user download exactly the items they selected.

## Change
Add a download button to the select-mode action row in the header (`src/routes/_authenticated/media.tsx`), placed just left of the delete button.

Behavior:
- Disabled when nothing is selected, or while a download is already running.
- Uses the existing download engine (`useDownloadAll`) that Download All already uses, so it picks the best strategy per device (streamed zip on desktop, in-memory/chunked zip on iOS) and shows the same progress card with cancel.
- Only selected items that are finished and have a file are included; unfinished/generating items are skipped.
- One selected item downloads as the single file directly (existing engine behavior), multiple selections download as a zip named with a "selected" label and today's date.
- Shows a spinner in place of the icon while working, matching Download All.
- Selection mode stays active after starting the download so the user keeps their selection.

## Technical notes
- Reuse the `downloadAll` hook instance already present in the component; pass the mapped selected assets plus filter label `"selected"`.
- Reuse the existing `DownloadAllProgress` overlay already mounted at the bottom of the route — no new progress UI.
- No backend, schema, or download-library changes.
