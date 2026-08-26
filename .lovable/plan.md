# Keyboard arrow navigation for the orb cluster

## What it does

On any device with a keyboard (built-in or Bluetooth), the four arrow keys act exactly like pressing the matching orb on the home screen:

- Up arrow → blue orb (previous sentence)
- Down arrow → purple orb (next sentence)
- Left arrow → yellow orb (open menu)
- Right arrow → green orb (next document)

Same behavior as a click, including the speech that follows, favorites cycling, and locked-list rules. The pressed orb also plays its usual giggle animation so it's clear which one fired.

## Rules

- Arrow keys are ignored while a dialog, the editor, the composer, chat, or any other popup is open (the existing "busy" guard the spacebar shortcut already uses), so typing and normal arrow-key text editing are untouched.
- Ignored when focus is in an input, textarea, or contenteditable field.
- Ignored when a modifier key (Cmd/Ctrl/Alt/Shift) is held.
- Holding an arrow key repeats the action (native key repeat), matching repeated presses.
- Nothing changes for touch-only devices; no new UI is added.

## Technical notes

- Add one `keydown` listener in `src/routes/_authenticated/app.tsx` alongside the existing spacebar effect, mapping `ArrowUp/ArrowDown/ArrowLeft/ArrowRight` to the same handlers already passed to `OrbCluster` (`onSwipeUp`, `advanceSentence`, `setMenuOpen(true)`, `onSwipeRight`), reusing `busyRef` as the guard and calling `preventDefault()` so the page doesn't scroll.
- To trigger the visual giggle, `OrbCluster` exposes a small imperative way to flash a given orb (refs to the four buttons plus a `pressOrb(color)` handle, or a `keyboardPress` prop), so the keyboard path reuses the exact same press path as a click rather than duplicating logic.

## Verification

Preview check with Playwright: press each arrow key on the home screen and confirm prev/next/menu/next-document behave identically to clicking, that the orb animates, and that arrow keys inside the editor and search fields still move the text cursor normally.
