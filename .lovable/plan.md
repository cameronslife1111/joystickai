## Add ⚡️ Swap Slot button (slot 23)

Add a new menu action in `src/routes/_authenticated/app.tsx` that swaps every favorites slot currently holding the active document to the next document in alphabetical order.

### Behavior

1. If the active document is not in any favorites slot → toast "This document isn't in any slot" and no-op.
2. Determine the "next" document using the same sort as the rest of the app: `sortDocsByTitle(docs)` (emoji → numbers → letters → other, then locale-compare). The next document is the one immediately after the active doc in that sorted list. If the active doc is the last one, wrap to the first.
3. Build a new `favorites` array where every slot whose value === `activeDocId` is replaced with the next document's id. Other slots are untouched.
4. Persist via the existing `saveFavorites(next)` path (same flow used by manual slot edits — writes to `user_preferences.favorites`).
5. Update `favIdxRef` / `last_favorite_slot` so the user's "current slot" pointer continues to point at the same slot index (now holding the new doc), using the existing `saveLastFavoriteSlot` helper. Then navigate the view to the new document (set `activeDocId` to the next doc) — mirroring what happens when the user manually changes a slot — and show a toast like `Swapped to "<Doc B>" in N slot(s)`.

### UI placement

In the `grid` array, add a new entry:

```
{ e: "⚡️", t: "Swap slot", fn: () => { setMenuOpen(false); void swapSlot(); } }
```

Wire it into the slot grid as slot 23 (index 22 in `filled`):

```
filled[22] = grid[23]; // 23 Swap slot
```

Slot 24 (Sign out) at `filled[23]` is unchanged.

### Edge cases

- Only one document total → toast "No other document to swap to" and no-op.
- Active doc not in favorites at all → toast and no-op (rule 1).
- Active doc occupies multiple slots → all of those slots get the same next-doc id (per request).
- Do NOT change which sentence index the user is on inside the newly-active doc; just navigate to it the same way slot navigation already does.

### Out of scope

- No DB schema changes.
- No changes to `sortDocsByTitle`, swipe handlers, or other menu slots.
