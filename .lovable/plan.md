# New "＋ New document" button under chat replies

Add a fourth small button under each Orby reply bubble that creates a brand-new document containing that reply.

## What changes for you

1. Under every reply bubble, next to ▶️ play, 📋 copy and 📤 send-to-document, there's a new **＋** button.
2. Pressing it opens a small dialog: "Name your new document" with a text field (pre-filled with a short suggestion taken from the reply's first few words) plus Cancel and Create.
3. Pressing Create makes a new document with that name, splits the reply into sentences, and puts them in the document. If the name is left blank it uses "Untitled".
4. A toast confirms it ("Created <title>"), the dialog closes, and you stay in the chat exactly where you were. The new document shows up in your docs list right away.

## Technical notes

- `src/components/ChatDialog.tsx`:
  - New state `newDocFor: ChatRow | null` and `newDocTitle: string`; the ＋ button (lucide `FilePlus` icon, same 3.5 size/styling as the others) sets `newDocFor` for assistant rows only.
  - New small `NewDocFromReplyDialog` component in the same file, matching the existing dialog styling used by `InsertIntoDocDialog` (rounded-3xl card, max-w-md, w-[calc(100vw-1.5rem)] safe on mobile).
  - Create flow: `supabase.auth.getUser()` → insert into `documents` with `{ user_id, title, position }` (position = current `documents` count, same pattern as the import flow in `app.tsx`) → `splitIntoSentences(row.content)` → `supabase.rpc("insert_sentences_at", { p_document_id, p_contents, p_insert_at: 0 })`.
  - Invalidate `["documents"]` and `["sentences", newDocId]` so lists refresh; guard with a `busy` flag so double-taps can't create two docs.
  - Enter submits, Escape cancels; errors surface via `toast.error`.
- No database or server-function changes.
