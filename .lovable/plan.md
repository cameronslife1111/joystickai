# Add ⚪️/⚫️ circles and remove 🐝

## Goal
Across every place that shows the colorful circle "filter" buttons: remove the bee (🐝) and add a white circle (⚪️) and a black circle (⚫️). Also add the circle filter row to the Favorites slot list (which currently has none).

## Current state
A shared list drives every circle row:

```text
EMOJI_FILTERS = ["🐝", "🟣", "🔵", "🔴", "🟢", "🟡", "🟠", "🟤"]
```

It's defined in three files:
- `src/routes/_authenticated/app.tsx` — used in the document Search overlay AND the favorites document picker (after you tap a slot).
- `src/components/DocumentPickerSheet.tsx`
- `src/components/LinkDocumentDialog.tsx`

The Favorites **slot list** (the screen listing slots 1–50) has no circle row today.

## Changes

### 1. Update the circle list everywhere
In all three files, change the array to:

```text
EMOJI_FILTERS = ["⚪️", "⚫️", "🟣", "🔵", "🔴", "🟢", "🟡", "🟠", "🟤"]
```

This automatically updates: the document Search overlay, the favorites document picker, the DocumentPickerSheet, and the LinkDocumentDialog. The 🐝 is gone; ⚪️ and ⚫️ are added.

### 2. Add a circle filter row to the Favorites slot list
On the Favorites editor (the slots 1–50 list in `app.tsx`), add the same circle button row just above the slot list. Tapping a circle filters the visible slots to those whose document title contains that emoji; tapping it again (or a "clear" affordance) shows all slots. This uses a new local filter state and filters the rendered `Array.from({ length: 50 })` slots by the chosen emoji against each slot's document title. Empty slots are hidden while a filter is active.

## Verification
- Open the document Search overlay → circle row shows ⚪️ ⚫️ then the colors, no 🐝. Tapping each filters results.
- Open Favorites → tap a slot → document picker shows the same updated circle row.
- Open Favorites slot list → new circle row appears; tapping a circle narrows the slot list; clearing restores all slots.
- Link-document dialog and document picker sheet show the updated circles.
- Check on the 390px mobile viewport so the extra circle still wraps cleanly.

No backend or schema changes.