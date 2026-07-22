## Goal

Add an invisible tap/click zone above the existing right-side "Repeat sentence" button that triggers the same action as Slot 24 (📚 Next linked doc).

## Change

In `src/routes/_authenticated/app.tsx`, right after the existing right-side invisible Repeat button (around line 2545–2553), add a third invisible `<button>`:

- Positioned to the right of the orb, stacked ABOVE the Repeat zone (upper-right flank).
- `onClick={() => { void openNextLinkedDocument(); }}` — reuses the exact same handler wired to Slot 24, so behavior stays perfectly in sync.
- `aria-label="Next linked doc"`, `opacity-0`, same width footprint as the Repeat zone so it feels natural on mobile and desktop.
- Uses a native `<button>` with `onClick`, which fires on both touch tap and mouse click — no extra pointer/touch handlers needed.

Approximate classes (mirrors Repeat, but occupies the top half instead of the vertical middle):
`absolute bottom-1/2 left-full ml-4 mb-2 h-[33%] w-[22vw] max-w-[120px] opacity-0`

Repeat button stays where it is; we just place the new zone above it so both remain reachable without overlap.

## Technical details

- File touched: `src/routes/_authenticated/app.tsx` only.
- No changes to gestures, `useOrbGestures`, or `openNextLinkedDocument` itself.
- No new state, no new imports.