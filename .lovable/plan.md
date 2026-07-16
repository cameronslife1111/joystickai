## Fix document-icon gestures + React #185 crash

### 1. Rebind orb gestures when the visual swaps

`src/hooks/use-orb-gestures.ts` — add an optional `rebindKey` option to the deps of the pointer-binding `useEffect`. When it changes, tear down old listeners and rebind to the current `ref.current`. No behavior change when the key stays constant.

`src/routes/_authenticated/app.tsx` — pass `rebindKey: docIconUrl ?? "orb"` (or a boolean) to `useOrbGestures`, so switching between `<Orb>` and `<DocumentIconAvatar>` re-attaches pointerdown/up/move/cancel to the new button. Long‑press, tap, and all swipe directions then work identically on the image avatar.

### 2. Stop React error #185 loop from the assign dialog

`src/components/AssignDocumentIconDialog.tsx`:
- Replace the `useEffect(..., [open, existing])` dep on the `existing` array with a stable primitive key (e.g. join sorted ids). New array references from React Query refetches no longer retrigger the reset.
- Only seed `selected`/`initial` once per dialog open (guard by `open` transition), so post-save invalidations don't reset state while the dialog is closing.
- Narrow the post-save `invalidateQueries({ queryKey: ["document_icon"] })` to be predicate-based (or use `refetchType: "none"` for keys that aren't visible) so we don't force the active document's icon query into a tight refetch cycle while the dialog is still mounted.

### 3. Sanity checks after the fix

- Reload a document that has an assigned image: verify tap opens editor, left-swipe opens menu, up/down/right swipes navigate, long-press opens chat, and the invisible flanking buttons still work.
- Assign an image to 50 documents in one save: dialog closes cleanly, no crash, icon shows on those documents.
- Remove all assignments: Orby returns and its gestures still work (rebindKey flips back).

### Notes / technical

- The gesture hook currently reads `ref.current` inside the effect; because deps don't include the element identity, swapping components leaves stale bindings. `rebindKey` is the minimal, low-risk fix — no refactor to callback refs, no change to how `orbRef` is consumed elsewhere (still forwarded through `Orb` and `DocumentIconAvatar`).
- No DB schema, RLS, or edge-function changes. UI/hook only.
