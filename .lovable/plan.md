## Goal

Extend the Slot 18 "Link to doc" feature so a sentence can link to a **chat thread** instead of a document. Right-swiping such a sentence opens that chat exactly like Slot 11 → tap thread.

## What the user sees

1. The "Link this sentence" popup gets two tabs at the top: **Docs** | **Chats**.
   - Docs tab: today's behavior unchanged (emoji filters, search, list, Linked badge, Unlink).
   - Chats tab: searchable list of the user's existing chat threads (newest first), tap one to link, currently-linked thread shows the "Linked" badge, same Unlink button.
2. A sentence with a linked chat shows the same pill under the header as linked docs, labeled with the thread title and a chat icon instead of the link icon. Tapping the pill opens the chat.
3. Right swipe on that sentence opens the chat dialog directly on that thread (no thread list, no new thread creation) — same as pressing Slot 11 and tapping the thread.
4. If "Read replies aloud" is enabled, opening the thread this way speaks the most recent assistant message, like it normally does. Sentence TTS is cancelled first so the two don't overlap.

## Behavior rules

- A sentence links to either a doc **or** a chat, not both. Picking a chat clears any linked doc, and vice versa — so right swipe stays unambiguous.
- Same "apply to all identical sentences in this document" rule the doc-link already uses.
- If the linked thread was deleted, show "Linked chat not found" and fall through to normal right-swipe navigation.
- Linking is blocked/no-op while the document editor is open, matching existing linked-doc navigation guards.

## Technical details

Database
- Migration adding `linked_thread_id uuid` to `public.sentences`, referencing `public.chat_threads(id) on delete set null`, plus an index. Existing RLS/grants on `sentences` already cover it; no policy changes needed. Regenerate types.

`src/components/LinkDocumentDialog.tsx`
- Add tab state (`"docs" | "chats"`) rendered as a small segmented control in the dialog header.
- Accept `currentLinkedThreadId` and a `threads: { id, title, updated_at }[]` prop (fetched in the dialog from `chat_threads` ordered by `updated_at desc`, scoped by RLS).
- `handlePick` gains a mode: doc picks write `{ linked_document_id: docId, linked_thread_id: null }`; chat picks write `{ linked_thread_id: threadId, linked_document_id: null }`; Unlink clears both.

`src/routes/_authenticated/app.tsx`
- Add `linked_thread_id` to the `Sentence` type and the sentence select (already `select("*")` in most paths — verify the few explicit column lists).
- New `openLinkedChat()` callback: verifies the thread exists, cancels speech via `claimSpeech()`, sets `pendingChatThreadId` to the thread id, `chatStartInList = false`, and opens `ChatDialog`.
- `onSwipeRight`: check `linked_thread_id` before the linked-doc branch; if present, call `openLinkedChat()` and return.
- Header pill: render for either link type, using thread title + chat icon when it's a chat link.
- Pass `currentLinkedThreadId` to `LinkDocumentDialog`.

`src/components/ChatDialog.tsx`
- When a thread is opened via `openThreadId` and "Read replies aloud" is enabled, speak the last assistant message once after messages load (guarded by a per-thread ref so it doesn't repeat on re-render or fire during streaming).
