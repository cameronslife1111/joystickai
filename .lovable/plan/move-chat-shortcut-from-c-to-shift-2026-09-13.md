# Move chat shortcut from C to Shift

Move the existing "C" keyboard shortcut behavior (open the linked chat for the current sentence, otherwise open the chat list) to the **Shift** key. Both left and right Shift should work the same way.

## What to change

In `src/routes/_authenticated/app.tsx`:

1. Remove the `case "c":` branch from the letter-shortcuts `useEffect`.
2. Add a new `useEffect` keydown listener for the Shift key, placed next to the existing letter-shortcuts listener.
3. The Shift handler must use the same guard sequence as the other reading-mode shortcuts:
   - Ignore if any of `metaKey`, `ctrlKey`, or `altKey` are held (Shift itself is the trigger, so `shiftKey` is expected).
   - Ignore if `busyRef.current` is true.
   - Ignore if the active element is an `INPUT`, `TEXTAREA`, `SELECT`, or `contentEditable` surface.
4. On Shift keydown:
   - If `currentSentence?.linked_thread_id` exists, call `openLinkedChat()`.
   - Otherwise open the chat list: `setPendingChatThreadId(null); setChatStartInList(true); setChatOpen(true);`.
5. Prevent auto-repeat while Shift is held by only acting on the first keydown for a given Shift press.
6. Add `e.preventDefault()` after the action fires.

## Verification

- `bunx tsgo --noEmit` must pass.
- Build log must report `build OK`.
- No other shortcut behavior changes.
