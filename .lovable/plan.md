## Goal

1. Give the two invisible right-side buttons real separation so it's obvious which one you're tapping.
2. Remove the sluggishness on right-swipe that appeared after we added the Next-linked-doc zone.

## Change 1 — Reposition the invisible zones (`src/routes/_authenticated/app.tsx`, ~lines 2545–2561)

Keep the Repeat zone exactly where it used to be — vertically centered directly to the right of the orb. Move the Next-linked-doc zone up and off to the northeast so it no longer shares the horizontal band next to the orb.

- **Repeat sentence** (unchanged): `absolute top-1/2 left-full ml-4 h-2/3 w-[22vw] max-w-[120px] -translate-y-1/2 opacity-0`
- **Next linked doc** (new position): sits at the top-right corner, above the orb's centerline, clearly outside the Repeat band.
  - Classes: `absolute bottom-full left-1/2 mb-4 h-[22vw] max-h-[120px] w-[22vw] max-w-[120px] opacity-0`
  - This places it up and to the right of the orb (bottom edge just above orb's top, horizontally starting at orb center and extending right/off), so there's a clear vertical gap between it and Repeat.

Both stay `opacity-0` invisible buttons using native `onClick`, so mobile taps and desktop clicks both work — no gesture code changes.

## Change 2 — Fix right-swipe lag

Root cause: the previous northeast zone sat in the same horizontal band as the Repeat zone, directly in the finger's path during a right-swipe. On touch, when the pointer left the orb and crossed into that button, the browser fired hover/hit-test work on it and, in some cases, deferred the orb's `pointerup` (or fired a stray click on release). Moving the zone out of the horizontal swipe band (Change 1) already removes the interference.

Additionally, harden the two invisible zones so they never absorb an in-flight swipe:

- Add `touch-action: none` and `style={{ pointerEvents: 'auto' }}` — but critically, only accept the click when it's a real tap, not the tail of an orb swipe. Simplest reliable way: add `onPointerDown={(e) => e.stopPropagation()}` is NOT needed; instead, add `touch-action: manipulation` class and rely on the orb's `setPointerCapture` (already in `useOrbGestures`) which keeps `pointerup` on the orb during a swipe. The remaining risk is a residual `click` firing on the button after pointer capture releases — guard against it by checking movement:
  - Track `pointerdown` X/Y on each invisible button; in `onClick` bail if the pointer moved more than ~10px between down and up (i.e. it was a swipe, not a tap). This is a tiny local handler on each of the three invisible buttons (delete, repeat, next-linked-doc).

Net effect: right-swipes finish immediately on the orb without the invisible buttons stealing or delaying the gesture; genuine taps on each zone still fire instantly.

## Technical details

- File touched: `src/routes/_authenticated/app.tsx` only.
- No changes to `useOrbGestures`, `openNextLinkedDocument`, `onSwipeRight`, or any data-fetching code.
- No new state, no new dependencies. The tap-vs-swipe guard is a tiny `useRef`-based down-position check colocated with each invisible button.