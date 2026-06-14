## Goal
Restore real swipe gestures on the Orby orb (replacing the current invisible tap-zone overlays) so navigation feels fast and works across phones, tablets, and desktop (mouse).

## Desired gesture map
- **Swipe up** → next sentence
- **Swipe down** → previous sentence
- **Swipe left** → open the grid menu
- **Swipe right** → favorites / next-document cycling (existing `onSwipeRight` logic, unchanged)
- Tap / double-tap / triple-tap / long-press behaviors stay exactly as they are today (new idea / edit / delete / Plan composer).

## What's there now
In `src/routes/_authenticated/app.tsx`:
- The `useOrbGestures(orbRef, {...})` call wires tap/doubleTap/tripleTap/longPress but **does not pass `onSwipe`**.
- Four invisible `<button>` overlays sit on top of the orb's face (top third = previous, bottom third = next, left/right thirds = menu / next doc). These overlays intercept pointer events, which is why true swipes don't fire.
- The `use-orb-gestures` hook already fully supports `onSwipe(direction)` via pointer events (works for touch + mouse) — it just isn't being used.

## Changes (all in `src/routes/_authenticated/app.tsx`)

1. **Add `onSwipe` to the `useOrbGestures` call** mapping:
   - `up` → `advanceSentence()` (next sentence, with speech)
   - `down` → `onSwipeUp()` (this is the existing "go to previous sentence" callback)
   - `left` → `onSwipeLeft()` (open menu)
   - `right` → `onSwipeRight()` (favorites / next-doc cycling)
   - Each branch also calls `orbRef.current?.boostMood?.()` to keep the mood-boost feedback the tap zones had.

2. **Remove the four invisible directional overlay buttons** (the top/bottom/left/right `opacity-0` buttons added to "replace swipes"). These must be removed so they stop intercepting pointer events and blocking swipe detection on the orb.

3. **Keep** the two flanking "repeat sentence" invisible buttons (left/right of the orb) — they are not directional and don't overlap the orb's gesture surface in a way that blocks vertical swipes. (If testing shows they interfere, narrow them; otherwise leave as-is.)

4. **Tune responsiveness** in the `useOrbGestures` options for fast, reliable swipes on all devices: keep a modest `swipeThreshold` (~40px) and `moveCancelPx` so quick flicks register as swipes rather than taps, and ensure the orb element keeps `touch-none` (already set in `Orb.tsx`) so the browser doesn't hijack vertical swipes as page scroll.

## Verification
- Test in the preview with mouse drag (up/down/left/right) and confirm sentence navigation + menu + favorites trigger correctly.
- Confirm tap still creates a new idea and the orb mood still boosts on gesture.
- Resize to mobile viewport and confirm swipes feel smooth and don't trigger page scroll.

## Notes
- No backend, plan-mode, or document-lookup logic is touched — this is purely the orb's input handling on the main app screen.
