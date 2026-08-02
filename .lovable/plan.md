## Goal
In the chat, tapping the attached-document chip (the part showing the title) closes the chat and opens that document, exactly like opening it from search. The little ✕ keeps removing the attachment.

## Changes

**`src/components/ChatDialog.tsx`**
- Add an optional prop `onOpenDocument?: (documentId: string) => void`.
- In the attached-doc chip (around lines 880-897), turn the title span into a `<button>` that:
  - calls `onOpenChange(false)` to close the chat, then
  - calls `onOpenDocument(id)`.
- The ✕ button stays as-is (with `stopPropagation` so removing never triggers navigation).
- Give the title button a subtle hover/underline affordance plus an `aria-label` like `Open "<title>"`.

**`src/routes/_authenticated/app.tsx`**
- Pass `onOpenDocument={(id) => void goToDocument(id)}` to `<ChatDialog />`.
- `goToDocument` is the existing helper already used for linked docs/locked lists: it fetches the document's saved sentence index and sentences, sets the active doc, and speaks the resolved sentence — identical behavior to opening a document from search.

## Notes
- `goToDocument` already no-ops when the editor is open, so navigation stays blocked during editing.
- No database or server-function changes.
