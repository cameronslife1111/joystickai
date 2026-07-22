## Remove Slot 24 "Next Linked Doc" button and its invisible tap zone

### Changes

**`src/routes/_authenticated/app.tsx`**
1. Remove the Slot 24 menu button (📚 "Next linked doc") — leave the slot empty in the menu grid so all other slot positions stay unchanged.
2. Remove the invisible northeast tap zone above the orb that also triggers `openNextLinkedDocument()`.
3. Remove the now-unused `openNextLinkedDocument` function and any supporting state that only serves it (e.g. `linkRootRef` and related source-position sync logic), provided nothing else references them.

### Preserved
- Repeat-sentence invisible button (right of orb) stays exactly where it is.
- All other slots, gestures, swipes, and menu functions remain untouched.
- No backend/schema changes.

### Verification
- Grep for `openNextLinkedDocument` and `linkRootRef` after edits to confirm zero remaining references.
- Confirm build passes and menu grid still renders 24 slots with slot 24 as an empty placeholder.
