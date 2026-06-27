## Swap Slot 14 and Slot 21, Update AI Plans Emoji

### What changes
1. **Slot swap**: Move the "Recent docs" button from slot 14 to slot 21, and move the "AI Plans" button from slot 21 to slot 14.
2. **Emoji update**: Change the "AI Plans" button emoji from 📋 to 🤖 so it no longer duplicates the clipboard emoji already used on slot 7 (Copy sentence).

### File changes
- `src/routes/_authenticated/app.tsx`
  - In the `grid` array: change the "AI Plans" entry (`grid[21]`) emoji from `📋` to `🤖`.
  - In the `slots` / `filled` mapping: swap `filled[13]` (slot 14) and `filled[20]` (slot 21) so slot 14 points to `grid[21]` (AI Plans) and slot 21 points to `grid[24]` (Recent docs).

No other logic changes — the underlying `recentOpen`, `plansScreenOpen`, `pendingPlanCount` badge, and all handlers stay exactly the same.