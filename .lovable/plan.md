## Goal
When the user presses the Swap slot button (slot 24), the search/text area should automatically contain the green circle emoji (🟢) — exactly as if they had pressed the green circle filter — so the document list is immediately narrowed to documents whose title has a green circle.

## The change (one file: `src/routes/_authenticated/app.tsx`)

The Swap slot action (line 1896) currently opens the favorites picker with an empty search:

```
fn: () => { setMenuOpen(false); setReplaceMatching(true); setPickerQuery(""); setFavoritesOpen(true); setPickerSlot(0); }
```

Change `setPickerQuery("")` to `setPickerQuery("🟢")` so the search field starts pre-populated with the green circle and the list is filtered to green-circle documents right away. The user can still clear or edit the field afterward.

## Notes
- No backend/database changes.
- Pure frontend/presentation change — reuses the existing search filtering that already handles emoji queries.
