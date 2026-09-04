# Stop chat replies from reading aloud when the chat isn't open

## The problem

When you send a message and then leave the chat while Orby is still thinking, the reply is read aloud as soon as it finishes — even though the chat is closed. It should stay silent and only be read when you reopen that chat (which already works).

## Cause

The reply-finished code checks whether the chat is open, but it uses the value captured at the moment you pressed Send. Closing the chat afterwards doesn't change that captured value, so the check still thinks the chat is open and speaks.

## The fix

- Track the chat's open state and the currently viewed thread in a live reference that always reflects "right now", and check that at the moment the reply arrives instead of the value from when the message was sent.
- Same treatment for the short spoken cue when a reply turns into a plan, so nothing is announced while the chat is closed.
- Leave the existing behavior intact: reopening the chat still reads the latest reply once, per-message Play buttons are unaffected, closing the chat still stops any speech in progress, and hands-free calls still suppress auto-read.
- Also confirm the unread badge/thread bump logic keeps using the same live state so a reply received while closed stays marked unread.

## Technical notes

- `src/components/ChatDialog.tsx`: add a ref updated on every render with `{ open, activeThreadId }`; use it in the post-send auto-read branch (currently guarded by the stale `open && threadId === activeThreadId`) and in the plan-cue path. No changes to `src/lib/speech.ts`.

## Verification

Send a message, close the chat while it's thinking, and confirm silence when the reply lands; reopen the chat and confirm it reads then. Repeat with a document open and its speak function running to confirm nothing interrupts it.
