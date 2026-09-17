# Linked chat keeps reopening when you pick another chat

## The problem

When you open a linked chat, the app remembers "open this specific chat" the entire time the chat window is up. So when you open the chats list and tap a different chat, that standing instruction kicks back in and drags you straight back to the linked one. It should be a one-time instruction — once the linked chat opens, you're free to go anywhere.

## The fix

- When the chat window opens a chat because of that instruction, it immediately tells the main screen "done — you can forget it now," so the instruction is cleared.
- From then on, opening the chats list and tapping any chat works normally and stays on the chat you chose.
- Everything that opens a specific chat (the gray linked-chat button, the green → next-linked-chat button, the plans screen) still works exactly as before — they set a fresh one-time instruction each time.

## Technical notes

- `src/routes/_authenticated/app.tsx` (ChatDialog usage, ~line 4523): add a new `onOpenThreadApplied={() => setPendingChatThreadId(null)}` prop next to `openThreadId`.
- `src/components/ChatDialog.tsx`: accept the new prop and call it in the two places `openThreadId` is applied — the bootstrap pass (~line 833) and the flip-while-open effect (~line 854). Once cleared, the effect's condition (`openThreadId === activeThreadId` / no openThreadId) stops snapping back.
- The auto-read guard (~line 1045) already keys off `openThreadId`, so clearing it after apply also keeps read-aloud behavior unchanged for other chats.
- No database or settings changes.

## Verification

Build log check, then in the preview: open a linked chat from the gray button, open the chats list, tap a different chat, and confirm it stays; go back and confirm the gray button and the green → button still open linked chats correctly.
