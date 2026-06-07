All changes are in `src/routes/_authenticated/app.tsx`. The list-lock state is `lockFavorites`.

## 1. Block opening a doc from Search docs when locked
In the `pickDoc` handler inside the Search-docs overlay (~line 2198), add a guard at the very top:
- If `lockFavorites` is true, show `toast.error("List is locked")` and `return` immediately.
- This runs before the speech and `setActiveDocId` logic, so the search box still opens and filters normally — tapping a result just shows the toast and does nothing else. The overlay stays open so they can keep searching.

## 2. Change the lock button emoji when locked
In the grid entry for the lock/unlock button (~line 1604-1612):
- Change `e: lockFavorites ? "🔒" : "🔓"` to use a distinct locked icon, e.g. `lockFavorites ? "⛔️" : "🔓"`, so locked vs. unlocked is visually obvious.
- Label text (`List locked` / `List unlocked`) stays as is.

## 3. Block the Pinned doc button when locked
In the "📌 Pinned doc" grid entry (~line 1589), update the `fn`:
- If `lockFavorites` is true, show `toast.error("List is locked")` and `return` (do not call `openPinnedDocument`).
- The long-press (choose a pinned doc) behavior is left unchanged unless you'd prefer it blocked too — by default I'll leave long-press working since it doesn't navigate to another list.

## Notes
- No backend/database changes needed; everything keys off the existing `lockFavorites` preference.
- Toast copy used consistently: "List is locked".
