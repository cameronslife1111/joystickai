# Fix: media gallery action menu can't scroll

## Problem

The action sheet that opens from the three-dot button in the image/video viewer lists up to 13 options (Rename, Download, View prompt, Regenerate, Remix, Image to Video, Video to Video, Audio + Image to Video, Set as document icon, Move to folder, Add to another folder, Remove from this folder, Delete). The sheet panel has no height limit and no scroll container, so on a phone the list runs past the top of the screen and the top items (including Rename) are unreachable.

## Fix

- Cap the sheet panel height (about 85% of the visible viewport) and make the button list itself scrollable with momentum scrolling and contained overscroll, so the backdrop behind it doesn't scroll instead.
- Keep the drag handle and the asset title pinned at the top of the sheet so the user always sees which asset they are acting on while scrolling.
- Keep the safe-area bottom padding so the last button (Delete) clears the iPhone home bar.
- Allow the title to wrap to two lines instead of truncating, matching the viewer title fix.
- No behavior changes to any of the actions themselves.

## Technical notes

Single file: `src/routes/_authenticated/media.tsx`, the "Long-press action sheet" block.

- Panel wrapper: add `max-h-[85svh] flex flex-col` and move padding so the scroll area is the inner list.
- Inner list: `flex-1 overflow-y-auto overscroll-contain` plus `-webkit-overflow-scrolling: touch`.
- Header (handle + title) stays outside the scroll area as a `shrink-0` block.
