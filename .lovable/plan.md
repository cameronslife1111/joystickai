# Add the wide bottom back button in three more places

Reuse the same look everywhere: full-width, 3rem tall, rounded, faint bordered button with a single left-arrow icon, sitting above the safe-area inset — identical to the one at the bottom of the menu and the media gallery.

## 1. Media viewer (image / video / audio preview)

- Add the wide back bar pinned to the bottom of the full-screen viewer.
- Tapping it closes the preview and returns to the gallery grid (same as the X).
- It follows the existing chrome show/hide toggle (visible when the other overlay controls are visible), and stops tap-through so the middle-tap and side-tap navigation still work.
- The 3-dots Options button moves up slightly so it sits above the new bar instead of overlapping it. The X in the top-right stays.

## 2. AI Plans screen

- Replace the small floating circular back button at the bottom-left with the wide full-width back bar across the bottom of the screen.
- Same behavior: closes the AI Plans screen and returns to Orby. The "Close" text button in the header stays.

## 3. Favorites panel (Slot 16)

- Add the wide back bar at the bottom of the Favorites card, below the slot list.
- It closes the Favorites panel (and any open slot picker), same as "Close".
- The slot list keeps its own scrolling; the bar stays pinned inside the card so it never covers the last slot.

## Technical notes

- Files: `src/routes/_authenticated/media.tsx` (viewer overlay), `src/components/AIPlansScreen.tsx`, `src/routes/_authenticated/app.tsx` (favorites overlay block).
- Viewer/plans bars use `paddingBottom: env(safe-area-inset-bottom)`; the favorites bar sits inside the card as a `shrink-0` footer with the list as `flex-1 min-h-0 overflow-y-auto`.
- Presentation-only: no data, query, or backend changes.
