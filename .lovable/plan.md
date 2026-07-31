## Goal

Keep the linked-chat feature intact, but change the right-swipe gesture so it goes back to cycling to the next favorite document. Opening a linked chat should only happen by tapping the linked chat pill under the sentence header.

## What changed

In the previous linked-chat update, `onSwipeRight` in `src/routes/_authenticated/app.tsx` was modified to check `currentSentence?.linked_thread_id` first and open the linked chat thread. We will remove that branch.

## Plan

1. **Update `src/routes/_authenticated/app.tsx`**
   - In `onSwipeRight`, remove the `if (currentSentence?.linked_thread_id)` block that calls `openLinkedChat()`.
   - Leave the existing `openLinkedChat()` callback unchanged — the linked chat pill in the header still uses it.
   - Leave the linked chat pill rendering unchanged.
   - Leave the `LinkDocumentDialog` tabs and `linked_thread_id` wiring unchanged.

## Result

- Right swipe returns to its previous behavior: if the current sentence links to a doc, open that doc; otherwise cycle to the next favorite document.
- A sentence with a linked chat still shows the "Linked chat" pill.
- Tapping that pill still opens the chat thread directly, with the same auto-read behavior when "Read replies aloud" is enabled.

## No changes needed

- Database schema (`linked_thread_id` column stays).
- `LinkDocumentDialog.tsx` (Docs/Chats tabs stay).
- `ChatDialog.tsx` (auto-speak on thread open stays).