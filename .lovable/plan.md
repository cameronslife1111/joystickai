The user wants to swap the positions of two buttons in the 4×6 menu grid:

- **Slot 6** currently holds the "Swap slot" button (⚡️). Move the "Move sentence" button (↕️) here instead, keeping its long-press behavior intact.
- **Slot 24** currently holds the "Move sentence" button (↕️). Move the "Swap slot" button (⚡️) here instead.

### Technical details
The mapping lives in `src/routes/_authenticated/app.tsx` inside the `slots` `useMemo` (~line 1897). The grid source items are in a `grid` array (~line 1789).  
- `grid[10]` is the Move sentence button (includes the `onLongPress` handler that calls `moveCurrentToBottom`).  
- `grid[23]` is the Swap slot button.

Currently:
```
filled[5]  = grid[23];  // slot 6  → Swap slot
filled[23] = grid[10];  // slot 24 → Move sentence
```

Change to:
```
filled[5]  = grid[10];  // slot 6  → Move sentence (long-press preserved)
filled[23] = grid[23];  // slot 24 → Swap slot
```

No other code needs to change; the long-press handler is attached to the `grid[10]` object, so it travels with the button when it is assigned to slot 6.

### Files changed
- `src/routes/_authenticated/app.tsx` — two lines in the `slots` useMemo mapping.