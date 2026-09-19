# Create-and-link from the "Link this sentence" popup

## What you'll see

When you long-press the green button to link a sentence, the picker gets a create button at the top of whichever view you're on:

- **Docs view** — a "＋ New document" button at the top of the list
- **Chats view** — a "＋ New chat" button at the top of the list

Tapping it opens a small naming popup (Create / Cancel only — tapping outside won't close it, matching the other popups). Press **Create** and the new document or chat is made with that name, immediately linked to the sentence (including any identical copies of that sentence in the same document, same as picking an existing one), and the picker closes with the usual "Sentence linked" confirmation. All existing behavior — searching, picking an existing document/chat, unlinking — stays exactly as it is.

## Technical details

All changes in `src/components/LinkDocumentDialog.tsx`:

1. Add a create button pinned above the scrollable list, label driven by the active tab (`docs` → "＋ New document", `chats` → "＋ New chat").
2. Add a nested name dialog (single input + Create/Cancel; `onInteractOutside`/`onEscapeKeyDown` prevented, same pattern as the rename popups).
3. **New document:** get the signed-in user, insert into `documents` with `position` = current doc count (mirrors `submitNewDoc` in `app.tsx`), then reuse the existing `applyLink` to write `linked_document_id`. Invalidate `["documents"]` and `["link_documents"]`.
4. **New chat:** call the existing `createChatThread(userId, title)` helper from `src/lib/chat-send.ts` (default capabilities, auto-attached documents), then `applyLink` with `linked_thread_id`. Invalidate `["link_chat_threads"]` and `["chat_threads"]`.
5. Errors toast and keep the picker open; busy state disables buttons while creating.

No database or settings changes.
