# Link the delegate chat to the sentence it came from

## Goal

When you long-press the purple orb, Orby already creates a brand-new "Delegate" chat. Now, that new chat will also be automatically linked to the exact sentence you were on — the same as if you had used the Link popup yourself. So afterward, the little chat pill appears on that sentence, and tapping the chat button (or pressing Shift) on that sentence jumps straight into the delegate chat.

## What changes (2 files)

1. **`src/routes/_authenticated/app.tsx` — `handleDelegate`**
   - The delegate payload already carries the document, title, and sentence index. Add the current sentence's `id` to it (e.g. `sentenceId: list[idx].id`).

2. **`src/components/ChatDialog.tsx` — delegate effect (~line 1334)**
   - Extend the `delegate` prop type with the optional `sentenceId`.
   - After the new delegate thread is created (`createThread` succeeds), also save the link: update that sentence's row, setting `linked_thread_id` to the new thread's id (and `linked_document_id` to null, matching how the Link popup stores chat links).
   - Invalidate the sentence queries so the home screen refreshes immediately and the linked-chat pill shows up without a reload.
   - Best-effort: if the link update fails, the delegate chat still works — the chat just isn't linked (no new error popups).

## What stays the same

- Everything else about delegate: the new chat opens, the document is attached, Orby proposes the 5 checkbox tasks as before.
- Linking through the Link popup, unlinking, auto-open linked chat, and the Shift shortcut all work exactly as before — this just reuses the same link the popup already writes.

## Technical notes

- No database changes: `sentences.linked_thread_id` already exists and this uses the same update the Link popup performs.
- No new dialogs, buttons, or settings; single press of the purple orb (next sentence) is untouched.
