# Don't read chat aloud until an actual chat is open

## The problem

Long-pressing the gray orb (or slot 11) opens the chat at the thread picker — but Orby starts reading the latest reply anyway. It should stay silent until you actually tap into a chat.

## Cause

Confirmed by reading `src/components/ChatDialog.tsx`:

- When the chat window opens, the bootstrap effect (line 578) always picks a thread — the saved "last chat" or the most recent one — even when the picker list is showing (`startInThreadList` only opens the drawer on top; the thread still loads underneath).
- The auto-read effect (line 791) speaks the latest assistant reply as soon as `open`, `autoSpeak`, `activeThreadId`, and loaded `messages` are all true. It never checks whether the thread list drawer is covering the chat, so it fires while you're still choosing a chat.
- The "reply arrived while you were away" path uses a live ref (`viewRef`, line 714) with the same blind spot: it knows the window is open and which thread is loaded, but not that the picker is showing — so a reply landing while you browse the list would also read aloud.

## The fix

- Gate the auto-read effect on the thread list being closed: only read the latest reply when the window is open, the picker drawer is closed, and you're actually viewing the thread. When you tap a thread in the picker, the drawer closes and the effect fires once — which preserves the current "open a chat and it reads the latest reply" behavior.
- Add the same picker-closed check to the live reference used when a reply finishes, so a reply that lands while you're still in the picker stays silent and is read when you open that chat.
- No changes to anything else: per-message Play buttons, hands-free, the sound toggle, and the unread badge logic all stay as they are.

## Technical notes

- `src/components/ChatDialog.tsx`: add `!drawerOpen` to the auto-speak effect's guard and include `drawerOpen` in its dependency array (line 791–803); add `drawerOpen` to the `viewRef` object (line 714–715) and check it in the post-send auto-read branch alongside `open` and `threadId === activeThreadId`.
- No changes to `src/routes/_authenticated/app.tsx`, the gray orb, or slot 11 wiring — they correctly open the picker.

## Verification

- Long-press the gray orb: thread picker opens, silence. Tap a chat: the latest reply reads aloud once.
- Slot 11 from the menu: same — silent in the picker, reads when a chat is opened.
- Send a message, back out to the picker while Orby is thinking: silence when the reply lands; opening the chat reads it.
- Open a chat directly (e.g. from a linked chat pill): still reads the latest reply immediately, as before.
- Run the typecheck and check the build log.
