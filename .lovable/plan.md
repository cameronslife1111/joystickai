# Export text → choose what to export

Currently the "Export text" menu button (slot 17, 💾) immediately exports **all documents** as a single `.txt` file. We'll make it first ask what the user wants.

## New behavior

Tapping "Export text" opens a small chooser dialog with three options:

1. **All documents (.txt)** — the current behavior (`handleExportAll`).
2. **Current document (.txt)** — export only the active document as a text file.
3. **Current document (.pdf)** — export only the active document as a PDF.

If no document is open, options 2 and 3 show an error toast ("No document open").

## Implementation (`src/routes/_authenticated/app.tsx`)

- Add state `exportChooserOpen` and render an `AlertDialog`/`Dialog` with three buttons (matching the app's existing dialog styling).
- Change the slot-17 button `fn` to open the chooser instead of calling `handleExportAll` directly.
- Add `handleExportCurrentTxt`: pull the active document's sentences (reuse the same query pattern as "Copy document"), join them, and download as `<title>.txt` using the existing timestamped-filename + Blob/anchor download approach.
- Add `handleExportCurrentPdf`: build a PDF from the active document's sentences and download `<title>.pdf`.
- Each option closes the chooser after running.

## PDF generation

Add the `jspdf` package (no PDF library is currently installed). The PDF will contain the document title as a heading followed by each sentence, wrapped to the page width with automatic page breaks. Filename uses the document title plus the same timestamp format already used for exports.

## Notes

- Pure frontend/presentation change plus one client-side dependency; no backend or schema changes.
- Reuses existing filename/timestamp logic for consistency.
