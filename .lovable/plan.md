# Note button: put a document's text into the chat box + roomier typing area

## What you'll see

**1. New note button in the chat row**

Next to the red record button and the schedule clock, a small note icon appears. Tap it and the familiar document list opens (with the emoji filters and search). Pick a document, press Done, and the document's full text is typed into the message box right where your cursor was — you can keep typing, edit it, or delete it freely.

- Nothing gets attached to the chat: this only types text, unlike the "Documents" button.
- If you pick more than one document, their texts are added one after another, separated by a blank line.
- Sentences of a document are joined with a space, in the order they appear in the document.
- If a picked document is empty, a short toast says there was nothing to add.

**2. Bigger message box**

The typing area starts at about double its current height and grows as you type, wrapping onto new lines, up to a taller maximum before it scrolls — so long messages no longer feel cramped.

## How it works technically

- `src/components/ChatDialog.tsx`
  - New state `docTextPickerOpen`.
  - New `insertDocTextAtCursor(docs)`: for each selected doc id, query `sentences` (`select id, content`, `eq document_id`, `order order_index`) via the existing supabase client, join contents with `" "`, join documents with `"\n\n"`, then reuse the existing cursor-splice logic. Refactor the tail of `insertQuotedTitles` into a shared `spliceAtCursor(text: string)` used by titles, doc titles, and this new insert; keeps cursor placement and the add-a-space-if-needed behavior identical.
  - Add a `StickyNote` (lucide) icon `Button size="icon" variant="ghost"` between the mic and clock buttons, `aria-label="Insert document text"`, opening the picker.
  - Render a fourth `DocumentPickerSheet` with `initialSelectedIds={[]}`, `heading="Insert document text"`, no-op `onConfirm`, and `onConfirmDocs={insertDocTextAtCursor}`.
  - Textarea: change `className="max-h-40 min-h-[44px] …"` to `min-h-[88px] max-h-64`, add `rows={3}`, and keep `resize-none` so it auto-grows within those bounds (`field-sizing-content` if available in the current Tailwind textarea styles, otherwise the existing behavior with the new min/max).

No database or backend changes.

## Verification

Open a chat, tap the note icon, pick one document, press Done: its text appears at the cursor and the attached-documents count is unchanged. Type a long message and confirm the box starts taller and wraps/grows.
