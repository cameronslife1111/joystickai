# Fix mobile layout of the media generation popups

## What's wrong

The three popups (Image to Video, Video to Video, Audio + Image to Video) all use the shared dialog shell. That shell is `w-full max-w-lg` with `p-6` and no side margin, and its body is a CSS grid whose children are allowed to keep their natural minimum width. On a 390px-wide phone, wide rows (the source-image thumbnail row, dropdown triggers, the attachment chip strip, the footer buttons) push past the screen edge, so the page scrolls sideways instead of stacking everything vertically.

## Changes

1. Shared dialog shell (`src/components/ui/dialog.tsx`)
   - Width becomes `w-[calc(100%-1.5rem)] max-w-lg` so there is always a visible margin on phones, and rounded corners on all sizes.
   - Padding drops to `p-4` on mobile, `sm:p-6` on larger screens.
   - Add `max-h-[85svh]`, vertical scrolling, `overflow-x-hidden`, and `min-w-0` on the content grid so nothing can create horizontal scroll.
   - Footer gets `gap-2` on mobile so stacked buttons don't touch.

2. The three generation popups
   - Remove the now-redundant `max-h-[90vh] overflow-y-auto` from each `DialogContent`.
   - Add `min-w-0` to the flex rows and text containers that hold long titles (source image row, reference video row, end/element image row, audio clip row) so titles truncate instead of stretching the dialog.
   - Make the "Change" / remove controls `shrink-0`.
   - Footer buttons go full width on mobile (`w-full sm:w-auto`) so Cancel/Generate stack cleanly.
   - Keep the attachment chip strip horizontally scrollable but constrain it so it can't widen the dialog.

3. No behavior changes: models, options, defaults, generation calls, and pickers stay exactly as they are.

## Technical notes

- Files: `src/components/ui/dialog.tsx`, `src/components/ImageToVideoDialog.tsx`, `src/components/VideoToVideoDialog.tsx`, `src/components/AudioImageToVideoDialog.tsx`.
- The dialog shell change is intentionally global; other dialogs in the app inherit the same mobile-safe sizing, which is the correct fix rather than patching each popup.
- Verification: open each popup at 390x694 and confirm `document.documentElement.scrollWidth` equals the viewport width (no sideways scroll) with all controls reachable by scrolling down only.
