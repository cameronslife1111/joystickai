## Goal

Replace the chat's "Insert into document" dialog (dropdown + radio buttons) with the same staged, tappable flow used by the New Idea "Send to…" overlay: pick a list (with emoji filters + search), then pick where in the list, including "After a specific sentence…".

## What exists today

- `src/components/ChatDialog.tsx` → `InsertIntoDocDialog` uses a shadcn `Dialog` with `DestinationPicker` (a `Select` for the doc + `RadioGroup` for top/bottom/after current) and an Insert button.
- `src/routes/_authenticated/app.tsx` has the target UX: a staged overlay with `sendStage` = `"doc" | "where" | "pickAnchor"`, emoji filter chips, a search input, sorted doc list buttons, then large tap targets (Top / After current / After a specific sentence… / Bottom), and a sentence-anchor list.

## Plan

1. **Rewrite `InsertIntoDocDialog` in `src/components/ChatDialog.tsx`**
   - Keep it inside a `Dialog` (so it stays in the chat surface), but style the content to match the New Idea overlay: rounded card, staged header title — "Send to which list?" / "Where in the list?" / "After which sentence?" — and a Cancel action.
   - Add local state: `stage`, `searchQuery`, `anchorIdx`, `targetSentences`; reset all when the dialog opens.
   - Stage `doc`: emoji filter chips (same 9 emoji set as elsewhere in the app), a "Search lists…" input, then the doc list sorted with `sortDocsByTitle` and filtered by the query, rendered as full-width tappable rows. Empty-state text matches the New Idea copy.
   - On picking a doc: load that doc's sentences (id, content, ordered by `order_index`) into `targetSentences` and advance to stage `where`.
   - Stage `where`: four buttons — ⤒ Top of list, ● After current sentence (disabled when the doc has no sentences), ⋯ After a specific sentence… (primary style; falls back to Top when empty), ⤓ Bottom of list — plus a "← Pick a different list" link back to stage `doc`.
   - Stage `pickAnchor`: scrollable numbered sentence list with selection highlight, a "← Back" button, and "Insert after sentence N".

2. **Insert logic (same behavior, extended)**
   - Keep `splitIntoSentences(row.content)` + `supabase.rpc("insert_sentences_at", …)`.
   - Compute `insertAt` per choice: top → 0; bottom → sentence count; after current → `current_sentence_index + 1`; after anchor → `anchorIdx + 1` (using the already-loaded sentence list).
   - Keep the existing success toast, `["sentences", docId]` / `["documents"]` invalidation, and `onClose()`.

3. **Cleanup**
   - Remove the now-unused `DestinationPicker` import from `ChatDialog.tsx`. Leave `src/components/DestinationPicker.tsx` in place (still used elsewhere).

## Result

Sending a chat reply to a document feels identical to the New Idea "Send to…" flow: emoji filters, searchable list, then big tap targets for placement, with the extra option to insert after a specific sentence.
