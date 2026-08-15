# Eliminate horizontal overflow in the three video popups

## Goal

Keep Image to Video, Video to Video, and Audio + Image to Video fully contained within the phone viewport. The popup may scroll vertically, but the shell, prompt fields, dropdowns, media rows, and buttons must never extend or scroll to the right.

## Changes

1. **Give the shared dialog a strict mobile width**
   - Replace the current fragile width calculation with a valid viewport-based width that always leaves side margins.
   - Add `max-w-full`, sizing containment, and zero minimum width to the dialog and its direct children.
   - Keep vertical scrolling while preventing the shell itself from creating horizontal overflow.

2. **Constrain every form column in the three video popups**
   - Add `w-full max-w-full min-w-0` to the main form stack and each field group.
   - Explicitly constrain textareas, select triggers, slider rows, attachment strips, and footer controls to the available dialog width.
   - Allow long button labels to wrap on narrow screens rather than forcing the popup wider.

3. **Compact selected-media rows on phones**
   - Change rows containing a thumbnail, title, Change button, and remove control to a mobile-safe grid so fixed controls stay visible and the title uses only the remaining width.
   - Reduce thumbnail size and spacing on the smallest screens where needed, while preserving the current larger layout at `sm` and above.
   - Keep titles truncated and fixed controls non-shrinking.

4. **Keep dropdown menus inside the viewport**
   - Constrain the three popups' dropdown panels to the trigger/viewport width.
   - Wrap long option labels instead of letting them establish a wider intrinsic width.

## Scope

- `src/components/ui/dialog.tsx`
- `src/components/ImageToVideoDialog.tsx`
- `src/components/VideoToVideoDialog.tsx`
- `src/components/AudioImageToVideoDialog.tsx`
- Shared select styling only if required to contain the opened option panels; no generation behavior or defaults change.

## Verification

At the current 390×694 mobile viewport, open all three popups and their dropdowns, then confirm:

- popup left and right edges remain visible;
- prompt fields, selectors, media rows, and action buttons stay within those edges;
- `scrollWidth` never exceeds the viewport width;
- only vertical scrolling is needed;
- desktop sizing remains unchanged.
