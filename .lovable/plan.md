## Goal

Move five menu buttons to new positions without changing any of their functions. Only the `slots` mapping in `src/routes/_authenticated/app.tsx` (lines 1502–1531) changes.

## Requested moves

- Swap **Search docs** (slot 11) ↔ **Plan mode** (slot 20)
- **Swap slot** (slot 23) → slot 24
- **Media gallery** (slot 10) → slot 23
- **Sign out** (slot 24) → slot 10

## Change (single edit)

Update these lines in the `slots` array (`filled[N]` = slot N+1):

```text
filled[9]  = grid[14]; // 10 Sign out        (was Media Gallery)
filled[10] = grid[20]; // 11 Plan mode       (was Search docs)
filled[19] = grid[11]; // 20 Search docs     (was Plan mode)
filled[22] = grid[16]; // 23 Media Gallery   (was Swap slot)
filled[23] = grid[23]; // 24 Swap slot       (was Sign out)
```

All other slots stay the same. No button logic, no `fn` handlers, and no backend touched — purely a position remap.
