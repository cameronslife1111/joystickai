## Goal
Resize the menu pop-up grid from 3×5 to 4×6 (24 slots) and add two new actions: Copy sentence and Copy full document. The whole grid must fit in the pop-up on mobile (390×701) with no scrolling.

## Changes (all in `src/routes/_authenticated/app.tsx`)

### 1. Grid layout — 4 columns × 6 rows
- Change the menu grid container from `grid-cols-3` to `grid-cols-4`.
- Change the slots padding from `< 15` to `< 24` so empty squares fill the full 4×6.
- Drop `aspect-square` on each tile (a 4×6 of square tiles overflows on a 390-wide phone) and give tiles a fixed compact height (e.g. `h-20`) so 6 rows + header + padding fit inside the pop-up without scrolling.
- Shrink inner typography slightly (emoji `text-xl`, label `text-[10px]`) so the smaller tile still reads cleanly.
- Keep the slot-number badge in the top-left corner.

### 2. New action — Copy sentence (📋)
Append to the `grid` array. On tap:
- Close the menu.
- Take `currentSentence?.content`. If empty, show `toast.error("No sentence to copy")` and return.
- Synchronously call `navigator.clipboard.writeText(text)` inside the tap handler (required for iOS clipboard permission).
- On success: `toast.success("Copied sentence")`. On failure, fall back to a hidden textarea + `document.execCommand("copy")` and toast accordingly.

### 3. New action — Copy full document (📄)
Append to the `grid` array. On tap:
- Close the menu.
- Read the cached `sentences` for `activeDocId` from React Query (`qc.getQueryData(["sentences", activeDocId])`). If missing, fetch via Supabase, then continue.
- Join sentence `content` values with a single space (matching how the doc reads aloud) into one string.
- Copy via the same clipboard logic as above.
- Toast `Copied document` on success, `Failed to copy` on error.

Note: the existing toaster is already pinned to `top-center` from the earlier fix, so both toasts will appear at the top automatically.

### 4. Order in the grid
Insert the two new actions next to the existing doc-content actions for discoverability:
1 Theme · 2 Sound · 3 New doc · 4 Rename · 5 Delete · 6 Favorites · 7 Jump to · 8 Move sentence · 9 Search docs · 10 Copy sentence · 11 Copy document · 12 Sign out. Remaining 12 slots stay empty (faded) inside the 4×6.

## Out of scope
- No DB changes.
- No changes to existing actions' behavior.
- No changes to send-to, edit, favorites flows.
