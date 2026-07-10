## Goal
Add a long-press gesture to the "🕘 Recent docs" grid button (Slot 14 in the menu) that takes the user back to the document they were viewing *before* the current one — without opening the Recent docs list. A normal tap keeps opening the Recent docs list as it does today.

## How it works today
- `recentIds` (in `src/routes/_authenticated/app.tsx`) is a most-recent-first, de-duplicated list of opened document IDs, persisted to `localStorage` (`orby-recent-docs`). It updates every time `activeDocId` changes: the active doc is moved to the front (`recentIds[0]`).
- This means `recentIds[1]` is always the previously-viewed distinct document.
- The grid button (`{ e: "🕘", t: "Recent docs", fn: ... }`, ~line 1860) currently has only a tap `fn` that opens the Recent docs overlay, and no `onLongPress`. The grid renderer (`MenuGridButton`) already supports an `onLongPress` handler via a 500ms timer.

## Change (single file: `src/routes/_authenticated/app.tsx`)
Add an `onLongPress` to the "Recent docs" grid item that:
1. Reads the previous document ID = `recentIds[1]`.
2. Verifies it still exists in `docs`.
3. If it exists: close the menu (`setMenuOpen(false)`), set it as active (`setActiveDocId(prevId)`), and speak its current sentence (mirroring the existing Recent-docs `pickDoc` speak behavior) so the experience matches selecting from the list.
4. If there is no valid previous document, do nothing (or show a brief "No previous document" toast).

No changes to business logic, data, or the `recentIds` tracking itself.

## Note on behavior
Because opening the previous doc pushes it to the front of `recentIds`, repeated long-presses will toggle back and forth between the two most recent documents — a natural "back" behavior. If you'd prefer a deeper multi-step history stack instead of a simple toggle, tell me and I'll track a separate navigation history.

## Verification
- Open Doc A, then open Doc B. Open the menu and long-press 🕘 Recent docs → lands on Doc A and reads its current sentence.
- A normal tap on 🕘 Recent docs still opens the Recent docs list.
