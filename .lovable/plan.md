# Auto-open linked chats

## What changes

The theme popup (opened from the theme button) gets a third section: **Linked chats**, with a simple on/off toggle labelled "Open linked chats automatically".

When it's on, landing on a sentence that has a chat linked to it opens that chat right away — exactly the same as pressing the little "Linked chat" pill yourself. Everything from there behaves as it does today, including the green/yellow/purple status dot and read-aloud only when the chat is actually open.

Details that keep it from being annoying:

- It only fires for chat links, not document links (same condition as the pill).
- It won't fire while you're editing a sentence or the full document, while a document is composing, or while any chat is already open.
- After you close the chat, it does not immediately reopen on the same sentence. Moving to another sentence (or coming back to that one later) arms it again.
- The choice is saved to your account, so it follows you to any device you sign in with. Off by default.

## Technical notes

- Migration: `alter table public.user_preferences add column if not exists auto_open_linked_chat boolean not null default false;` then regenerate types. Existing RLS/grants cover it.
- `src/routes/_authenticated/app.tsx`:
  - Add `auto_open_linked_chat` to the prefs `select` and returned shape (line ~511/519), plus state `autoOpenLinkedChat` and a `saveAutoOpenLinkedChat` callback mirroring `saveTapMode` (optimistic `qc.setQueryData`, upsert `{ user_id, auto_open_linked_chat, favorites }` with `onConflict: "user_id"`), and a hydrate effect mirroring the `tap_mode` one.
  - New effect after `openLinkedChat` (line ~1371): when `autoOpenLinkedChat && !chatOpen && !editing && !quickEditing && !composing && currentSentence?.linked_thread_id && !currentSentence.linked_document_id`, and `autoOpenedRef.current !== <sentenceId>`, set `autoOpenedRef.current = sentenceId` and `void openLinkedChat()`. The ref stores the last sentence id auto-opened so closing the chat doesn't loop; it resets when `currentSentence?.id` changes to a different id.
  - Popup UI (line ~3443): a "Linked chats" label plus one full-width pill button acting as a toggle (`✅ On` / `⬜️ Off` styling matching the existing selected/unselected classes) calling `void saveAutoOpenLinkedChat(!autoOpenLinkedChat)`.

## Verification

Typecheck plus the build log, then in the preview: turn the toggle on, navigate onto a sentence with a linked chat and confirm the chat opens by itself and reads only then; close it and confirm it stays closed until you move sentences; turn it off and confirm the pill still works manually.
