## Change: locked-list swipe-right should repeat the current sentence

In `src/routes/_authenticated/app.tsx`, `onSwipeRight` currently early-returns when `lockFavorites` is true, so nothing happens. Update that branch to instead re-speak the current sentence (same behavior as when only one slot is filled / one doc exists), respecting the mute state via the existing `speak` helper.

### Edit (around line 559–562)

Replace the early `return` with a repeat-speak path:

```ts
if (lockFavorites) {
  const token = claimSpeech();
  const text = sentences?.[currentIdx]?.content;
  if (text) speak(text, token);
  return;
}
```

Add `sentences` and `currentIdx` to the `useCallback` dependency array on line 636.

### Notes

- Uses the existing `speak` + `claimSpeech` flow, so mute/sound-on behavior, iOS unlock, and the talking/lip-sync indicators all keep working unchanged.
- No change to the lock icon, menu entry, swipe-left, double-tap, or any other slot.
- No DB or schema changes.
