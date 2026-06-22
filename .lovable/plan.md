# Move sentence ↔ Swap slot positions + long-press move-to-bottom

All changes are in `src/routes/_authenticated/app.tsx` (frontend only).

## 1. Add long-press to the Move sentence button
The "Move sentence" grid entry (currently `{ e: "↕️", t: "Move sentence", ... }`) gets an `onLongPress` handler. On long press/click (works on mobile and desktop via the existing `MenuGridButton` long-press logic), it closes the menu and runs the same "Move to bottom" action the dialog uses:

```text
onLongPress: () => {
  setMenuOpen(false);
  void moveSentence((sentences?.length ?? 1) - 1);
}
```

This mirrors exactly what happens when the user opens the Move sentence dialog and taps "⤓ Move to bottom" (`moveSentence(sentences.length - 1)`).

## 2. Swap the grid positions of slot 6 and slot 24
In the `slots` arrangement `useMemo`:
- `filled[5]` (slot 6) currently = `grid[10]` (Move sentence) → change to `grid[23]` (Swap slot)
- `filled[23]` (slot 24) currently = `grid[23]` (Swap slot) → change to `grid[10]` (Move sentence)

Result: the ⚡️ Swap slot button lives in slot 6, and the ↕️ Move sentence button (with the new long-press move-to-bottom) lives in slot 24.

## 3. Dependency wiring
The grid `useMemo` dependency array gets `moveSentence` and `sentences` added so the new `onLongPress` always references current sentence data.

## Notes
- Both buttons keep their existing tap behavior; only their grid positions change and Move sentence gains a long-press action.
- No backend, schema, or business-logic changes — `moveSentence` already exists.
