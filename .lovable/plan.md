## Problem

Every time the chat opens (orb long-press or Slot 11), a new "Chat" thread is created instead of resuming the previous one.

Root cause in `src/components/ChatDialog.tsx`:

- `useQuery` destructures with `data: threads = []`, so while the query is still loading, `threads` is `[]` (not `undefined`).
- The bootstrap effect's guard `if (threads === undefined) return;` never fires.
- Bootstrap sees `threads.length === 0`, hits the `else` branch, and calls `createThread("Chat")` before the real threads arrive.

The saved `orby_last_thread` id in localStorage is discarded because the list appears empty at that moment.

## Fix

In `src/components/ChatDialog.tsx`:

1. Pull `isFetched` (or `isSuccess`) from the `useQuery({ queryKey: ["chat_threads", userId] })` call.
2. In the bootstrap effect, wait for `isFetched` before deciding what to do — do NOT rely on `threads === undefined`.
3. Only call `createThread("Chat")` when `isFetched === true` AND `threads.length === 0` AND there is no matching saved/openThreadId. Otherwise pick `openThreadId` → saved `orby_last_thread` → most recent thread, exactly as today.

No other behavior changes. The explicit "＋ New chat" button in the thread drawer (line ~437, `createThread("New chat")`) remains the only user-facing way to create a thread, matching what the user asked for.

## Files touched

- `src/components/ChatDialog.tsx` — bootstrap effect + `useQuery` destructure only.

No changes needed in `src/routes/_authenticated/app.tsx`: both orb long-press and Slot 11 already just call `setChatOpen(true)` without passing `openThreadId`, so once the bootstrap is fixed both entry points correctly resume the last thread.
