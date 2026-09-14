# Link a document or chat to a sentence from a plan

Today Orby can already link a sentence to a **document** during a plan, but it can't link a sentence to a **chat**, and it can't find a chat by name. This adds that, and makes plan links behave exactly like the Link popup you use by hand.

## What you'll be able to say

- "Link the sentence about the launch date to my Marketing doc."
- "Link the first sentence of Cameron Inbox to my Delegate chat."
- "Find the chat called Weekly Review and link it to the sentence about Mondays."
- "Unlink the sentence about the old price."

Orby resolves the sentence and the target itself, shows it as a normal Go To step, and after the plan runs the little pill appears on that sentence — tapping it (or pressing Shift on it) opens the linked doc or chat.

## What changes

1. **New action: link a sentence to a chat.** Sets the chat link on the sentence and clears any document link, so a sentence has one link at a time — same rule the Link popup follows.
2. **Document linking clears the chat link too** (today it leaves a stale chat link behind), and both link actions apply to every identical sentence in that document, matching the Link popup's behavior exactly.
3. **New lookup: find a chat by title.** Fuzzy, loose matching like the document lookup — returns the best few chats so Orby never needs the exact name.
4. **Orby can see your chats.** The planner's snapshot gains a short chat list (id + title, most recent first), so simple requests resolve without an extra lookup step.
5. **Unlinking works from a plan** for both kinds of link.
6. **Planner guidance** so link steps always carry the concrete sentence id and target id, and never guess.

## Out of scope

- No change to the Link popup, the pills, the Shift shortcut, or auto-open linked chats.
- No new database columns — this uses the existing sentence link fields.
- Orby will not create a new chat just to link it; it links to a chat that already exists (creating chats stays a separate action).

## Technical notes

- `supabase/functions/_shared/tools.ts`: add `link_sentence_to_chat` (`sentence_id`, `target_thread_id` nullable) and `find_chat_by_title` (`query`); tighten the `link_sentence_to_document` description to state it clears any chat link.
- `supabase/functions/plan-step/index.ts`:
  - required-args map: add `link_sentence_to_chat: ["sentence_id"]`.
  - `link_sentence_to_document` handler: patch `{ linked_document_id: target, linked_thread_id: null }`; read the row's `document_id` + `content` and apply the update by `(document_id, content)` like `LinkDocumentDialog.applyLink`, falling back to the single id.
  - new `link_sentence_to_chat` handler: mirror image, `{ linked_thread_id: target, linked_document_id: null }`, validating the thread belongs to the user.
  - new `find_chat_by_title` handler: select `id, title` from `chat_threads` ordered by `updated_at`, score with the existing fuzzy title scorer used by `find_document_by_title`, return up to 5.
- `supabase/functions/plan-compose/index.ts`: add a `CHAT CATALOG (id — title)` block (most recent ~40 threads) to the workspace snapshot with the same "lookup table only, do not act on these" wording as MEDIA CATALOG, and add link-step rules to the destination-explicitness bullet.
- Redeploy `plan-step` and `plan-compose`.
