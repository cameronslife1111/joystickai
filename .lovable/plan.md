## Slot changes

- **Slot 7**: remove Copy sentence. Move Swap slot here (unchanged behavior).
- **Slot 24**: new "Next linked doc" button, emoji 📚, jumps to the next document linked from the source doc.

Concretely in `src/routes/_authenticated/app.tsx`, update the `slots` mapping:
- `filled[6] = grid[23]` (Swap slot on slot 7)
- `filled[23] = { e: "📚", t: "Next linked doc", fn: () => void openNextLinkedDocument() }`

The Copy sentence entry stays defined in `grid` but is no longer referenced by any slot (kept to preserve `grid` indices used elsewhere).

## Next linked doc feature

Behavior the user described: they're reading a source document (A). It has sentences that link out to other docs (B, C, D…). They swipe right on a link and land on B. Pressing **Next linked doc** should:

1. Return to source doc A (the root of the link chain, even if they've followed links B → B2 → B3).
2. From the sentence in A that they last opened a link from, scan forward for the next sentence in A whose `linked_document_id` points to a real, existing doc.
3. Open that linked document exactly like a swipe-right would: prime sentences, resume its saved sentence, trigger speech, show its icon avatar automatically (already handled by existing render path).
4. Update the remembered "last link-out sentence" in A so pressing 📚 again advances to the doc linked from the sentence after that, and so on.
5. If the user is on the source doc A itself (haven't followed a link yet), start from `currentIdx` in A and open the next linked sentence's document.
6. If A has no further linked sentences after that point, show a toast ("No more linked documents") and leave state unchanged.

### Tracking the "root" source doc

Add a small ref: `linkRootRef = useRef<{ docId: string; fromIndex: number } | null>(null)`.

- Whenever a link is followed (both `openLinkedDocument` and the swipe-right link branch), if `linkRootRef.current` is null, set it to `{ docId: activeDocId, fromIndex: currentIdx }`. If it's already set, leave it alone (we stay anchored to the original root even across nested link follows).
- When the user navigates in a way that clearly leaves the link chain — swipe up/down list cycling, opening a favorite/pinned/recent/search-picked doc, jumping via menu, `goToDocument` for the locked list — clear `linkRootRef` to null. Reading the code, the safe places to clear are: `onSwipeUp`/`onSwipeDown` (list nav), `goToDocument` (locked-list return, favorites/recent open), `openPinnedDocument`, and any doc-picker selection paths.
- The Next linked doc handler itself does NOT clear the root — following it counts as staying in the chain, and it updates `linkRootRef.current.fromIndex` to the newly used sentence index in A.

### `openNextLinkedDocument`

New callback in `app.tsx`:

1. Resolve root: `const root = linkRootRef.current ?? { docId: activeDocId, fromIndex: currentIdx }`. Guard when null.
2. Fetch source doc's sentences (prefer cached `qc.getQueryData(["sentences", root.docId])`; fall back to a supabase select ordered by `order_index`).
3. Find the first sentence with index `> root.fromIndex` where `linked_document_id` is non-null and the linked doc exists in `docs`.
4. If found: set `linkRootRef.current = { docId: root.docId, fromIndex: <that sentence's index> }`, then run the same prime-and-open sequence as `openLinkedDocument` against the linked doc id (fetch its `current_sentence_index` + rows, seed React Query caches, `setActiveDocId`, `speak(resolved.content, token)`). Close menu.
5. If not found: `toast("No more linked documents in \"" + rootTitle + "\"")` and no state change.

Speed: prime the target doc's sentence cache before flipping `activeDocId` (same pattern already used by `openLinkedDocument`), so the icon avatar / sentence text render on the next paint without a fetch flash.

### Files touched

- `src/routes/_authenticated/app.tsx` — slot remap, `linkRootRef`, root-set/clear hooks in existing nav callbacks, new `openNextLinkedDocument`, wire the new slot.

No schema, no policies, no other files.

### Edge cases handled

- Multiple links in A pointing to already-visited docs: still works — advancing is by sentence index in A, not by which doc was opened.
- Linked target deleted since last visit: skipped by the `docs.some(...)` existence check; scan continues.
- User edits/reorders sentences in A while away: the scan uses fresh data (cache is auto-invalidated by existing sentence-edit flows), so it uses the current order at press time.
