# Enlarge the home-screen orb cluster

## Goal
Make the six main control orbs significantly larger and spread them out so they're easier to press, while keeping the transparent center pad at its current 64px size and preserving all existing functionality.

## Current state
- The orb cluster is defined in `src/components/OrbCluster.tsx` (no hardcoded sizes — uses CSS classes).
- `src/styles.css` defines the cluster layout:
  - `@utility glow-orb`: orb size is 44px × 44px.
  - `.orb-cluster`: 5-column grid `44px 44px 64px 44px 44px` / 3-row grid `44px 64px 44px`.
  - `.orb-cluster-center`: 64px × 64px (transparent center pad).
  - `.glow-orb-face`: smiley SVG is 58% of orb size.

## Changes

1. **Increase orb size in `src/styles.css`.**
   - Update `@utility glow-orb` width/height from 44px to **96px** (more than double) while keeping `border-radius: 9999px` so they remain perfect circles.
   - Optionally scale the active shadow/press feedback proportionally.

2. **Widen the cluster grid so orbs don't overlap.**
   - Change `.orb-cluster` grid columns from `44px 44px 64px 44px 44px` to `96px 96px 64px 96px 96px`.
   - Keep rows as `44px 64px 44px` so the top/bottom orbs still sit above/below the center pad; the inner yellow/green orbs are vertically centered in the middle row.
   - Increase the `gap` from `clamp(6px, 2.2vw, 14px)` to a larger value (e.g. `clamp(12px, 4vw, 24px)`) so the outer red/orange orbs move farther out and no orb touches another.

3. **Keep the center pad unchanged.**
   - `.orb-cluster-center` stays 64px × 64px (the user explicitly requested this).
   - The center pad stays invisible and pressable; long-press recording still works through it.

4. **Adjust the smiley face proportion.**
   - `.glow-orb-face` stays at 58% of the orb size, so it automatically scales with the larger orb. No separate change needed unless the smiley looks too small; if so, reduce to ~50% or keep it.

5. **No React/JSX changes.**
   - `src/components/OrbCluster.tsx` only assigns grid positions via inline styles; no edits needed because the CSS classes handle sizing.
   - The press handlers, jiggle animation, and recording ring all continue to work on the resized elements.

## Verification
- Check the preview at mobile width (390px) and desktop width (1280px): all six orbs render larger, non-overlapping, and circular; the center pad remains transparent and shows the photo background through it.
- Tap each orb to confirm previous / next / menu / next-doc / delete / repeat still trigger.
- Long-press the center pad to confirm recording starts and the red ring appears.
- Make sure the smiley face and giggle animation are still visible and smooth.

## Files to change
- `src/styles.css` only.

## Out of scope
- No changes to orb colors, labels, or functions.
- No changes to the center pad size, gestures, or recording behavior.
- No changes to the landing-page orbs (those are sized separately).
