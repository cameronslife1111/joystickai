# "?" opens Recent docs, and delete-this-chat from the open chat

## 1. The "?" key opens Recent docs

While you are moving through sentences with the arrow keys, pressing `?` opens the Recent docs popup — the same list the red button opens on hold.

It stays silent in exactly the same situations as the other letter shortcuts: while typing in any text box, while editing, and while any popup is open.

One thing has to change to make this work: `?` is typed with Shift, and Shift on its own currently opens the chat. So Shift will fire when you tap and release Shift by itself; if you press another key while holding Shift (like `?`), the chat no longer opens. Tapping Shift alone behaves exactly as it does today.

## 2. Delete this chat, from inside the chat

In the confirm popup that appears when you tap the red trash can in an open chat, there will be two choices:

- Clear this chat — wipes the messages, keeps the chat (today's behavior).
- Delete this chat — removes the whole chat, exactly like deleting it from the chat list.

After a delete, the chat window closes, you land back on the document and sentence you were on, and that sentence is read aloud.

The popup title/wording is updated so both choices read clearly, and Cancel still leaves everything alone.

## Technical notes

- `src/routes/_authenticated/app.tsx`
  - Letter-shortcut effect: allow `e.key === "?"` (it arrives with `shiftKey` true, so the shortcut's modifier guard gets a `?` exception) and call `setRecentOpen(true)`.
  - Shift effect: track whether any other key was pressed during the Shift hold; fire the chat action on `keyup` of Shift only when nothing else was pressed. Keep the busy/typing/modifier guards.
  - `ChatDialog` gains an `onThreadDeleted` prop: closes the chat (`setChatOpen(false)` and the existing reset of pending thread / delegate state) and speaks `currentSentence.content` via `speak(text, claimSpeech())`, matching the pattern used by `PlanApprovalDialog`'s `onApproved`.
- `src/components/ChatDialog.tsx`
  - Clear-confirm `AlertDialog` (~2190) gets a destructive "Delete this chat" action that calls the existing `handleDeleteThread` path for `activeThreadId` (set `deleteThreadId` to it and reuse the same delete logic rather than duplicating), then closes the clear dialog.
  - `handleDeleteThread` calls the new `onThreadDeleted` callback after a successful delete instead of selecting/creating a replacement thread when the deleted thread was the open one and the callback is provided; list-view deletes keep today's behavior.

## Verification

- `bunx tsgo --noEmit` clean and build OK.
- Press `?` on the reading screen: Recent docs opens; tap Shift alone: chat still opens; `?` typed into the chat composer or the editor inserts a question mark and opens nothing.
- Open a chat, tap the trash can, choose Delete this chat: the chat disappears from the list, the window closes, and the sentence you were on is read aloud.
