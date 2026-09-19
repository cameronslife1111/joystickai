# Insert-document button in the full edit screen

## What you'll see

When you're in the full edit screen (the one that opens when you tap a sentence), there's a new round **📄 button** in the bottom button row, sitting to the right of 🏆:

```
✅   🔴   🏆   📄   ⬆️
```

Tap it and the familiar document picker opens (the emoji filters and search, same as in chat). Pick one or more documents, press **Done**, and the document's full text is dropped into your edit text **exactly where your cursor was** — even though the keyboard/picker took focus. If you pick several documents, their texts go in one after another with a blank line between them. If a picked document is empty, a short message says there was nothing to add.

Your edit is never saved or closed by this — it just inserts text; you keep editing and press ✅ when you're done.

## How it works technically

All in `src/routes/_authenticated/app.tsx`:

1. **Import** `DocumentPickerSheet` (already used by chat) and reuse its `onConfirmDocs` prop, which returns the picked docs' ids + titles.
2. **New state** `editDocPickerOpen` to open/close the sheet.
3. **Capture the caret on button press.** The new button uses `onPointerDown` with `e.preventDefault()` (like the existing 🔴 and 🏆 buttons) so the textarea keeps focus and the cursor position stays valid; it saves `editTextareaRef.current.selectionStart/End` into `editCaretRef.current`, then opens the picker.
4. **New `insertDocTextAtCursorIntoEdit(docs)`** — mirrors `ChatDialog.insertDocTextAtCursor`: for each picked id, query `sentences` (`select id, content`, `eq document_id`, `order order_index`), join contents with `"\n\n"`, join documents with `"\n\n"`; empty result → `toast.error("That document has no text yet")`. Then splice into `editText` at the saved caret (`editCaretRef.current`, falling back to the end), update the ref to land the cursor right after the inserted text, and restore focus + selection on the textarea via `requestAnimationFrame` (same pattern the 🏆 button already uses).
5. **Render** the sheet with `open={editDocPickerOpen}`, `initialSelectedIds={[]}`, `heading="Insert document text"`, a no-op `onConfirm`, and `onConfirmDocs={insertDocTextAtCursorIntoEdit}`.
6. **New button** in the `editing` row, placed between 🏆 and ⬆️, identical circular styling to its neighbors, `aria-label="Insert document text"`.

No database changes, no new components, no changes to chat.

## Verification

- `bunx tsgo --noEmit` and the build log stay clean.
- In the preview: tap a sentence to open edit mode, place the cursor in the middle of the text, tap 📄, pick a document, Done — its text appears exactly at the cursor and the cursor lands after it. Pick an empty document and confirm the "no text yet" message.
