# Keep the chat you just used at the top of the chats list

## Problem

When you open an older chat and send a message, the chat's "last used" time is
updated in the database, but the on-screen chats list keeps its old order until
the app is fully reloaded. So the chat you were just in stays buried down the list.

## Fix

In the chat screen (`src/components/ChatDialog.tsx`):

1. Extract the existing "bump thread" write into a small helper that does two things:
   - writes the new `updated_at` to `chat_threads`
   - immediately updates the cached thread list: set that thread's `updated_at`
     to now and re-sort so it sits first
2. Call that helper wherever a thread is used:
   - after sending a chat message (currently a fire-and-forget update near the
     end of the send handler)
   - after a voice/hands-free message is appended
   - when a thread is selected/opened from the chats view, so simply visiting an
     old chat pulls it to the top
3. Also mark the threads query stale after the write so the next background
   refetch confirms the same order coming from the server.

## Notes

No database or schema changes. Ordering already uses `updated_at desc`; this
only keeps the client list in sync with it.
