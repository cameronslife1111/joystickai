## Goal

When the user double-taps the orb to edit the current sentence, place the text cursor at the **end** of the text (not the beginning) so they can immediately continue typing.

## Change

File: `src/routes/_authenticated/app.tsx` — the `<textarea>` rendered when `editing === true` (around line 499).

Replace the plain `autoFocus` attribute with a `ref` callback that:
1. Calls `el.focus()`
2. Sets `el.selectionStart = el.selectionEnd = el.value.length`

This runs once when the textarea mounts (i.e., every time edit mode opens), guaranteeing the caret lands at the end of the existing sentence text. No other behavior changes — Enter still commits, Escape still cancels, blur still saves.

## Out of scope

- No changes to `onDoubleTap`, `commitEdit`, or any other handler.
- No styling or layout changes.