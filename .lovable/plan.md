# Fix "Jump to top" so it stays on the document

## Problem
When you tap **Jump to top**, the app moves to the first sentence and then automatically performs a swipe-right, advancing to the next document. You want it to simply stay on the current document at the top sentence and let you swipe right yourself when ready.

## Cause
In `src/routes/_authenticated/app.tsx`, the `jumpTo` function (around lines 593–606) has special-case logic: when the target is the top (`clamped === 0`), it waits 600ms and calls the swipe-right handler to auto-advance to the next favorite.

```text
if (clamped === 0) {
  await new Promise((r) => setTimeout(r, 600));
  await onSwipeRightRef.current?.();
}
```

## Change
Remove that auto swipe-right block (and its now-unneeded comment) from `jumpTo`. After the change, jumping to top just sets the index to 0 and speaks/repeats that first sentence, staying on the current document. Every other jump option (and manual swipe-right) is unaffected.

## Verification
- Tap Jump to → Jump to top: it moves to the first sentence, repeats it, and stays on the same document (no jump to the next doc).
- Swiping right manually still advances to the next favorite.
- Jump to end and other jump targets behave as before.