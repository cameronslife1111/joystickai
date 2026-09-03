# Lock the orange orb when the list is locked

## What it does

When the user has locked the list-cycling lock (long-press the blue up-arrow orb or the menu lock button), the orange orb is disabled along with the other navigation controls. Tapping or long-pressing the orange orb while locked does nothing except show the existing "List is locked" toast.

## Why

Right now the lock correctly blocks swipe-right list cycling, but the orange orb still opens the pinned document, which can take the user to a different list while the lock is active.

## How

1. In `src/routes/_authenticated/app.tsx`, guard the orange orb handlers:
   - `onPinnedDoc` — if `lockFavorites` is true, toast "List is locked" and return; otherwise call `openPinnedDocument()`.
   - `onPinnedDocLongPress` — if `lockFavorites` is true, toast "List is locked" and return; otherwise clear the search field and open Search docs.
2. Pass `lockFavorites` into `OrbCluster` so the orange orb can be visually dimmed while locked (lower opacity, no active scale).
3. In `src/components/OrbCluster.tsx`, accept the new `lockFavorites` prop and apply a disabled style to the orange orb when locked.

## Verification

- Lock the list, tap the orange orb: nothing navigates, "List is locked" toast appears.
- Lock the list, long-press the orange orb: Search docs does not open, "List is locked" toast appears.
- Unlock the list: orange orb tap opens the pinned document and long press opens Search docs as before.
