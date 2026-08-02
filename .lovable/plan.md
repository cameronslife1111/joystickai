## Goal
Add the same wide ← back button used at the bottom of the grid menu to the bottom of the chat popup. Clicking it closes the chat. Make the chat popup slightly shorter so the button fits without crowding.

## Current state
- `src/components/ChatDialog.tsx` renders a full-screen-ish dialog at `h-[92vh] max-h-[92vh]` with header, messages, and composer, but no bottom dismiss button.
- `src/routes/_authenticated/app.tsx` already has the target UI pattern: a full-width rounded-2xl button with a left arrow at the bottom of the grid menu overlay (lines 2604–2610).

## Changes
1. **Shrink the chat dialog**  
   Change `DialogContent` height from `h-[92vh] max-h-[92vh]` to `h-[88vh] max-h-[88vh]` (or equivalent) to leave room for the bottom button.

2. **Add the back button**  
   Insert a full-width button just above the composer (or as the last element inside `DialogContent`) with:
   - label `←`
   - same rounded-2xl, border, and muted background styling as the menu back button
   - `onClick={() => onOpenChange(false)}` so it always closes the current chat
   - appropriate `aria-label`

3. **Preserve existing behavior**  
   - The button closes the dialog regardless of which thread is open or how the chat was opened (Slot 11 or linked chat pill).
   - No changes to thread state, navigation, or data flow.

## Files
- `src/components/ChatDialog.tsx`

## Notes
- This is a presentation-only change; no backend, route, or gesture changes.
- The button should match the menu back button visually and functionally (close only, no navigation side effects).