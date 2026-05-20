## Goal
Make the long-press “Ask Orby to do something” popup fully usable on mobile so nothing extends off the right edge, all content stays inside the popup, and the action buttons remain reachable.

## Plan
1. Rebuild the popup layout as a mobile-safe vertical panel.
   - Keep the popup constrained to the viewport width.
   - Switch the popup body to a `flex` column layout instead of relying on the current grid container.
   - Add `min-w-0` / `overflow-x-hidden` to the dialog shell and to the inner sections that can currently force horizontal overflow.

2. Make the popup height predictable on phones.
   - Give the popup a fixed mobile height based on the viewport.
   - Put the form content inside a dedicated scrollable middle section.
   - Keep the bottom action area pinned so “Generate Plan” and “Cancel” never disappear off-screen.

3. Harden the specific rows that are likely causing the overflow.
   - Ensure the title/description block can shrink correctly.
   - Make the attached-document chips wrap safely within the available width.
   - Make the attach-documents toggle row, search input, and document result rows all use `min-w-0` and non-shrinking side elements correctly.
   - Make the footer buttons stack or wrap on narrow screens if needed instead of pushing the dialog wider.

4. Validate the dialog against real mobile constraints.
   - Check the popup at phone viewport sizes, especially the current 390px-wide mobile view.
   - Verify these states: empty form, long placeholder text, picker closed, picker open, multiple attached docs, and long document titles.
   - Confirm there is no horizontal scroll and that the primary action stays tappable.

## Likely root cause
The dialog width itself was constrained, but its internal content was not fully allowed to shrink. The current popup uses a grid-based dialog shell, and some inner rows still have intrinsic width behavior that can overflow on mobile. That makes the popup look correctly sized while its contents still extend to the right.

## Technical details
- Main file: `src/components/PlanComposerDialog.tsx`
- Supporting file to review while fixing: `src/components/ui/dialog.tsx`
- Likely implementation details:
  - Convert the composer dialog to a `flex h-[...] min-w-0 overflow-hidden` structure.
  - Add a scrollable middle container (`flex-1 min-h-0 overflow-y-auto overflow-x-hidden`).
  - Add `min-w-0` to header/content/footer subtrees and any horizontal flex rows.
  - Make footer actions responsive (`flex-col` on mobile or wrapping behavior).
  - Preserve the existing plan-generation behavior; this is a layout/usability fix, not a workflow change.

## Success criteria
- No part of the popup extends past the right edge on mobile.
- No horizontal scrolling is required anywhere in the popup.
- Long text and long document titles stay readable without breaking layout.
- The “Generate Plan” button is always visible or reachable via vertical scrolling only.
- The popup behaves cleanly on both mobile and desktop.