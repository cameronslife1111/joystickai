## Goal

Replace Orby's swipe gestures (up/down/left/right) with invisible press/click "buttons" placed over regions of Orby's face, keep single/double tap behavior on the center, and swap the up/down navigation direction so up goes up in the document and down goes down.

## Current behavior (for reference)

The `useOrbGestures(orbRef, ...)` hook on the Orb currently maps:
- single tap → new idea composer
- double tap → edit
- triple tap → delete sentence
- long press → plan composer
- swipe **up** → `advanceSentence` (next sentence)
- swipe **down** → `onSwipeUp` (previous sentence) — confusingly reversed
- swipe **right** → `onSwipeRight` (favorites / next doc)
- swipe **left** → `onSwipeLeft` (open menu)

## New behavior

### Directional regions become invisible buttons

Add four invisible (`opacity-0`) buttons layered over the orb container, each a single press/click on iPhone or computer. No triangles or visible markers — Orby looks exactly the same and stays the same size.

```text
        ┌──────────────┐
        │     TOP      │  ← press = go UP a sentence (previous)
        ├───┬──────┬───┤
        │ L │CENTER│ R │  ← L press = open menu, R press = next doc
        ├───┴──────┴───┤
        │   BOTTOM     │  ← press = go DOWN a sentence (next)
        └──────────────┘
```

- **Top region** → previous sentence (`onSwipeUp`) — *swapped*
- **Bottom region** → next sentence (`advanceSentence`) — *swapped*
- **Left region** → open menu (`onSwipeLeft`)
- **Right region** → next-doc functions (`onSwipeRight`)
- Each region also triggers the mood boost, like swipes did.

### Center face keeps tap gestures

The center stays the Orb itself, handling:
- single press/click → new idea composer (unchanged)
- double press/click → edit (unchanged)
- triple press → delete (unchanged)
- long press → plan composer (unchanged)

Swipe handling is removed from the gesture hook since swipes are replaced by the region buttons.

### Spacebar mirrors the center

A global keydown listener (ignored while editing or any dialog/overlay is open, using the existing `busyRef`):
- single **Space** → new idea composer (same as center single press)
- double **Space** (two presses within a short window) → edit (same as center double press)

## Technical details

- File: `src/routes/_authenticated/app.tsx`.
- In the `useOrbGestures` call, drop the `onSwipe` handler; keep `onTap`, `onDoubleTap`, `onTripleTap`, long-press handlers.
- In the orb `<section>` container (the square `relative` div around `<Orb />`), add four `absolute` `opacity-0` buttons positioned over top / bottom / middle-left / middle-right, each calling its handler plus `(orbRef.current as any)?.boostMood?.()`. They sit after `<Orb />` in the DOM so they layer above it; the uncovered center keeps falling through to the Orb for taps. The existing flanking "repeat sentence" buttons sit outside the orb and are unaffected.
- Add a `useEffect` keydown listener for `" "` / `"Space"`: call `e.preventDefault()` only when not busy, debounce to distinguish single vs double press (reuse the same compose/edit callbacks the center uses).
- No backend, schema, or business-logic changes — only gesture wiring and the new overlay buttons. All existing functions (`onSwipeUp`, `advanceSentence`, `onSwipeLeft`, `onSwipeRight`, edit, delete, plan composer) are reused as-is.
