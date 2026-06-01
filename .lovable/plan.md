## Goal

Change the **Swap slot** button (slot 23, ⚡️) so that pressing it behaves exactly as if you opened Favorites and tapped **Slot 1** — opening the slot-1 picker with "Replace all matching slots" already checked, so you can immediately type/pick the document to swap in.

## Current behavior

In `src/routes/_authenticated/app.tsx`, the menu action (line ~1497) runs:

```text
setMenuOpen(false); void swapSlot();
```

`swapSlot()` automatically advances every matching slot to the next alphabetical document. You don't want that anymore.

## New behavior

The button will instead open the Favorites overlay and immediately open the **Slot 1** picker, with the "Replace all matching slots" toggle on. This reuses the exact same picker UI you already use manually (search input, auto-focus keyboard, replace-all-matching checked, save-on-pick + close).

## Change

Single edit in `src/routes/_authenticated/app.tsx`:

- Update the "⚡️ Swap slot" menu item's `fn` from `() => { setMenuOpen(false); void swapSlot(); }` to:

```text
() => {
  setMenuOpen(false);
  setReplaceMatching(true);   // ensure "Replace all matching slots" is checked
  setPickerQuery("");          // start with empty search
  setFavoritesOpen(true);
  setPickerSlot(0);            // slot index 0 == "Slot 1"
}
```

This opens the same picker flow that tapping Slot 1 in Favorites produces. Picking a document then saves and closes automatically (existing `pickDoc` logic), so everything is saved with no extra steps.

## Technical notes

- `replaceMatching` already defaults to `true`, but we set it explicitly so the toggle is always checked when entering via this button.
- The "Replace all matching slots" toggle only renders when Slot 1 currently holds a document. Since you swap Slot 1 constantly, it will be populated. If Slot 1 is ever empty, the picker still opens normally (just without the toggle), letting you assign a doc.
- `swapSlot` becomes unused by this button. I'll leave the function in place (still referenced in the menu deps array) to avoid unrelated churn, unless you'd prefer it fully removed.
- No backend, schema, or other component changes.