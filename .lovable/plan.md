# Swap pink orb tap and long-press actions

Swap the pink orb so a single press opens **Jump to** and a long press opens **Move sentence**.

## Changes

1. `src/components/OrbCluster.tsx`
   - On the pink `ClusterOrb`, swap `onPress` and `onLongPress`:
     - `onPress={onJumpTo}`
     - `onLongPress={onMoveSentence}`
   - Update the `label` to `"Jump to (hold to move sentence)"`.

2. `src/routes/_authenticated/app.tsx`
   - No handler changes needed; keep passing `onMoveSentence={() => setMoveOpen(true)}` and `onJumpTo={() => setJumpOpen(true)}`.

3. `src/routes/index.tsx`
   - Update the landing-page `CLUSTER` label for the pink orb from `"Move sentence"` to `"Jump to / move sentence"`.

## Verification

- Tap the pink orb: opens the Jump to sheet.
- Hold the pink orb (~500 ms): opens the Move sentence sheet.
- Build passes.