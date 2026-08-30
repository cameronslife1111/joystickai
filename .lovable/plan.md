# Auto-attach documents to every new chat

Add an "Auto-attach" button next to **＋ New** in the chats list, where you pick the documents that should be attached automatically to every new chat you create.

## What changes for you

1. Open the chats list (the screen with all your chats and the **＋ New** button at the top right). Next to it there's a new **📎 Auto-attach** button, with a small count badge when documents are selected.
2. Pressing it opens the same document picker you already use to attach documents to a chat: emoji filters, search, checkboxes, sentence counts, **Done**.
3. Whatever you select is remembered as your default. Every new chat created after that starts with those documents already attached — including chats started from the ＋ New button, from the orb/chat shortcuts, and from "Send to → New chat" in the New idea composer.
4. Selecting nothing (unchecking everything) means new chats start with no attachments, exactly like today.
5. Existing chats are untouched; you can still add or remove attachments per chat as usual.

## Technical notes

- Migration: add `auto_attach_document_ids uuid[] not null default '{}'` to `public.user_preferences`. Existing RLS policies and grants already cover the table, so no policy changes.
- New tiny hook `src/lib/use-auto-attach-docs.ts`: reads/writes that column for the current user via the browser client (upsert on `user_id`), exposing `{ ids, save }` under query key `["auto_attach_docs", userId]`, plus a standalone `fetchAutoAttachDocIds(userId)` helper for non-React callers.
- `src/components/ChatDialog.tsx`:
  - Header of the chats drawer gets the Auto-attach button (lucide `Paperclip`, same `size="sm" variant="outline"` styling as New) and a second `DocumentPickerSheet` instance bound to the preference (separate open state from the existing per-thread picker so the two never collide).
  - `createThread()` includes `attached_document_ids: autoAttachIds` in the insert, so ＋ New, bootstrap-created, and Delegate threads all inherit it (Delegate keeps adding its own origin document on top, de-duplicated).
- `src/lib/chat-send.ts` → `createChatThread()` fetches the preference (or accepts the ids from the caller) and sets `attached_document_ids` on insert, covering New idea → Send to → New chat in `src/routes/_authenticated/app.tsx`.
- Scheduled-run threads (`src/lib/schedule-fire.server.ts`) keep using the schedule's own document list — the auto-attach default is a user-facing chat setting only.
- No server-function or AI-context changes: the chat pipeline already reads `attached_document_ids` from the thread.
