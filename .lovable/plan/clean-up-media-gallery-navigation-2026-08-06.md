# Clean up Media Gallery navigation

## What's wrong

The Media Gallery page is the only screen whose whole page scrolls. `/app` is locked to exactly one screen height with no page scrolling (`h-[100svh] max-h-[100svh] overflow-hidden`), so iPhone Safari keeps its toolbar collapsed. The gallery uses `h-[100svh] overflow-y-auto` on the page shell itself, so scrolling it makes Safari expand its bottom bar (share, refresh, compass, back) and the top address/page-menu row. That's the difference — nothing to do with folders or media logic.

On top of that, the gallery has two extra in-app ways to go back (the top-left arrow, plus the X in the media viewer overlay) and no big bottom back button like the menu has.

## Changes

1. Match the `/app` scroll model
   - Page shell becomes a fixed one-screen flex column: `h-[100svh] max-h-[100svh] overflow-hidden`.
   - Header, filter chips, select bar, upload banner stay pinned (non-shrinking).
   - Only the content area (folders list / media grid) scrolls, inside `flex-1 min-h-0 overflow-y-auto` with `overscroll-behavior: contain`, so Safari's chrome stays collapsed exactly like on the main Orby screen.

2. One back button, at the bottom
   - Add a full-width back button (left arrow) pinned to the bottom of the gallery, styled to match the menu's back button, sitting above the safe-area inset.
   - It behaves contextually: inside a folder it returns to the folders home; on the folders home it returns to `/app`.
   - Remove the top-left back arrow from the gallery header. The multi-select cancel (X) and the media viewer's own close X stay, since those close a mode/overlay rather than navigating.

3. Everything else untouched
   - Generate, Download-all (zip), + upload, folders, All media / Unsorted, multi-select, viewer, rename/delete menu: unchanged in behavior and position.

## Technical notes

- Single file: `src/routes/_authenticated/media.tsx`. No data, query, or backend changes.
- The content wrapper is inserted around the existing `MediaFoldersView` block and the grid `<section>`; their internals are untouched.
- Bottom bar uses `shrink-0` plus `paddingBottom: env(safe-area-inset-bottom)`, so it never overlaps the last row of media.
