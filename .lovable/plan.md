# Add "Document titles" button to chat settings

## What you'll see

In the chat settings panel, in the **Attach** row, a new button next to "Image titles": **Document titles**.

Tapping it opens the same document list you already use for attaching documents (with the emoji filter buttons and search). Pick one or more documents, press Done, and their titles get typed into the message box exactly like image titles do:

- each title wrapped in straight double quotes
- separated by `, ` when there is more than one
- inserted right where your cursor was, with a space added before/after only if needed
- cursor lands right after the inserted titles

Example: `"Grocery list", "Trip ideas"`

Picking document titles does **not** attach those documents to the chat — it only types their names. Attaching is still the separate "Documents" button.

## How it works technically

- `src/components/DocumentPickerSheet.tsx`: add two optional props — `heading` (defaults to "Attach documents") and `onConfirmDocs?: (docs: {id: string; title: string}[]) => void`. On Done, call `onConfirm` as today and additionally `onConfirmDocs` with the selected doc objects. Existing callers unchanged.
- `src/components/ChatDialog.tsx`:
  - new state `docTitlePickerOpen`.
  - extract the quoting/splicing logic already in `insertTitlesAtCursor` into a shared `insertTextAtCursor(titles: string[])` helper; `insertTitlesAtCursor` (images) maps assets to titles and calls it, and a new `insertDocTitlesAtCursor` maps documents to titles and calls it. Identical quoting/spacing behavior.
  - add the **Document titles** button in the Attach row (closes settings, opens the picker).
  - render a third `DocumentPickerSheet` with `heading="Attach Document titles"`, `initialSelectedIds={[]}`, and `onConfirmDocs={insertDocTitlesAtCursor}` (its `onConfirm` is a no-op so nothing gets attached).

## Verification

Open chat settings, tap Document titles, select two documents, press Done: the message box shows `"Title A", "Title B"` at the cursor, and the attached-documents count is unchanged.
