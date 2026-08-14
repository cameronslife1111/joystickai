# Slot changes shouldn't move you off your document

Right now, when you assign a document to a slot (from Favorites, or the ⚡️ Swap slot flow in slot 24), the app saves the slot and then jumps into the document you just picked — and even reads its sentence out loud. That's the bug.

## Desired behavior

- Picking a document for a slot saves the slot (including "Replace all matching slots").
- The picker and the Favorites sheet close.
- You stay on the document and the exact sentence you were on before opening the menu, and nothing new is spoken.
- Clear slot behaves the same as today.

## Technical notes

In `src/routes/_authenticated/app.tsx`, inside the slot picker's `pickDoc` (around lines 3074-3106):

- Remove the synchronous speech block that speaks the picked document's current sentence.
- Remove `setActiveDocId(docId)` so the active document is untouched.
- Keep the favorites array update, `closePicker()`, `setFavoritesOpen(false)`, and `saveFavorites(next)`.

No changes to the sentence index persistence logic, so the current sentence stays as-is.
