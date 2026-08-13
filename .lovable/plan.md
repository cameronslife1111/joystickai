# Make the repeat and delete buttons visible as glowing orbs

## Goal
Turn the two invisible flanking buttons around Orby (left = delete sentence, right = repeat sentence) into small, visible, glowing orb buttons so users can discover and tap them. The repeat orb should be green, the delete orb should be blue, and they should feel like a soft glow rather than a solid orb.

## Current state
In `src/routes/_authenticated/app.tsx` the buttons exist as `opacity-0` absolute-positioned zones on either side of the orb stage (lines ~2801–2818). They currently work but are not visible.

## Plan

1. **Add glowing-orb CSS utilities in `src/styles.css`.**
   - Create a base `.glow-orb` class: small round button (44px), translucent body, soft radial-gradient glow, subtle blur, and a gentle pulse animation.
   - Add modifier classes for the requested colors:
     - `.glow-orb--green` (repeat) — emerald/green glow.
     - `.glow-orb--blue` (delete) — blue/cyan glow.
   - Keep both light- and dark-mode compatible by using `color-mix` or opacity-based gradients tied to the theme background.

2. **Replace the invisible flanking buttons in `src/routes/_authenticated/app.tsx`.**
   - Keep the existing `onClick` handlers: left delete calls `deleteCurrent()`, right repeat reads the current sentence aloud.
   - Keep `aria-label` attributes for accessibility.
   - Position the new orbs just outside the main orb, centered vertically, with a 44px touch target.
   - Optionally include a tiny icon (e.g., repeat arrow / trash) inside each orb so the function is clear, but keep the overall look as a soft glowing circle, not a solid button.

3. **Verify in the preview.**
   - Check that both buttons render on the home screen next to Orby.
   - Tap each to confirm delete still deletes the current sentence (with undo toast) and repeat still speaks the sentence.
   - Make sure the new buttons do not block orb swipes or long-press recording.

## No scope changes
No new buttons, no new functions, no swipe changes. Only the visual treatment of the existing repeat and delete buttons changes.
