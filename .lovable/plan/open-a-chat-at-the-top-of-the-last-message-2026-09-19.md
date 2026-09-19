# Open a chat at the top of the last message

## What changes

Right now, opening any chat jumps all the way to the very bottom of the conversation. If the last reply is long, you land at its end and have to scroll back up to start reading.

After this change, opening a chat stops at the **top of the last message** so the newest reply starts right at the top of your view and you read downward.

This applies everywhere a chat opens:
- tapping a chat in the chats list
- the gray button opening a sentence's linked chat
- the green arrow jumping to the next linked chat
- returning to a chat that was already open (reopening the window)
- switching from one chat to another while the window is open

Unchanged: while you're already in a chat and a new reply arrives, it keeps following along to the bottom as it does today, so you can watch an answer being written. If the last message is short enough that the conversation can't scroll that far, it simply lands as far down as it goes.

## Technical detail

In `src/components/ChatDialog.tsx`:

- Add a `data-msg-row` attribute to each rendered row inside `messagesListRef` (both the plan-card branch and the bubble branch) so the last row can be located reliably.
- Add `scrollToLastBubbleTop(behavior)`: find the last `[data-msg-row]` child, compute `row.offsetTop - list.offsetTop` relative to `scrollRef`, subtract a small top margin (~12px), and clamp to `[0, scrollHeight - clientHeight]`. Falls back to `scrollToBottom` when no row exists.
- The open/thread-switch settle effect (currently re-pinning to bottom at 0/60/150/300/600/1000/1600ms) calls `scrollToLastBubbleTop("auto")` instead, keeping the same re-pin window so late-measuring media and plan cards don't shift the landing spot.
- Leave `scrollToBottom` in place for the new-message follow effect and the `ResizeObserver` re-pin; only the open/switch path changes.
