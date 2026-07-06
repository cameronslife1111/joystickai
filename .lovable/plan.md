## Goal
Rework Orby's gesture controls and add a second way to close the menu.

## Gesture changes (`src/routes/_authenticated/app.tsx`)
In the `useOrbGestures` config (~line 1011):
- Change `onTap` from `openNewIdea` → `onSwipeLeft` (open the menu). So a single press/click opens the menu.
- Change the `onSwipe` left case from `onSwipeLeft()` → `openNewIdea()`. So a left swipe now triggers the New Idea function.
- Leave `onDoubleTap` (double press) and `onTripleTap` (triple tap) unchanged.

Note: the spacebar shortcut (~line 1044) currently mirrors "single = new idea, double = edit". I'll leave it as-is unless you want it re-mapped too — it isn't part of the tap/swipe request.

## Menu back-arrow button (`src/routes/_authenticated/app.tsx`)
In the grid menu overlay (~line 2163), add a full-width button below the `slots` grid:
- A back arrow (←) button that calls `setMenuOpen(false)`.
- Styled to match the panel, giving a second close affordance alongside the existing top-right "Close" link.

## Verification
Load preview, single-press Orby → menu opens; left-swipe Orby → New Idea flow; double/triple tap still work; the new back-arrow button closes the menu.