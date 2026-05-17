## Goal

Turn the double-tap edit mode into a **full-document editor**: the user sees and can scroll/edit every sentence in the active doc, with the caret pre-placed at the end of the sentence they were on, that sentence centered in view. Add two action buttons above the orb: **Done** and **Jump To**.

## Behavior

### Opening (double-tap)
- Mount a single full-height scrollable `<textarea>` containing every sentence in `sentences`, joined with `\n\n` (blank line between sentences acts as the boundary).
- Auto-focus the textarea.
- Compute `caretPos = (sum of lengths of sentences[0..currentIdx-1] + 2 chars per separator) + sentences[currentIdx].length` — i.e. end of the current sentence.
- `setSelectionRange(caretPos, caretPos)`.
- Scroll so the caret line is roughly centered: temporarily set `selectionEnd` then call `scrollTop = (caretLineTop) - (clientHeight / 2) + (lineHeight / 2)`. We measure caret line position by creating a hidden mirror `<div>` with identical font/padding/width, slicing text up to caret, and reading the last span's `offsetTop`. (Standard textarea-caret-coord trick — no library needed, ~30 lines.)
- iOS Safari quirk: focus + setSelectionRange must run in the same user-gesture tick, otherwise the on-screen keyboard doesn't pop and the caret isn't placed. We already focus inside the ref callback synchronously, which runs during React commit triggered by the tap — safe. We add `inputMode="text"` and avoid `readonly` toggling that would dismiss the keyboard.

### Buttons (above the orb, same style as the New-idea Cancel/Send buttons)
- **Done** — save all edits, exit edit mode, and stay on a sensible sentence:
    - If the original `currentSentence.id` still maps to a non-empty parsed slice, jump to that new index.
    - Else clamp to `min(originalCurrentIdx, newSentences.length - 1)`.
    - If the doc is now empty, set index to 0.
- **Jump To** — read the textarea's `selectionStart` at click time, count separators before it to derive `targetIdx`, save all edits, exit edit mode, and `setIndex(targetIdx)`, then `speak()` that sentence.

Both buttons run the same save routine; only the post-save index differs.

### Save routine (single `commitFullEdit(targetIdx)`)
- `parts = editText.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean)` — paragraph-per-sentence parsing. This is simpler and more predictable than re-running `splitIntoSentences`, and matches what the editor visually shows.
- Diff `parts` against `sentences` by index:
    - For each `i < min(parts.length, sentences.length)`: if `parts[i] !== sentences[i].content`, `UPDATE sentences SET content=parts[i] WHERE id=sentences[i].id`.
    - If `parts.length > sentences.length`: `INSERT` new rows with `order_index = i` for the extra tail.
    - If `parts.length < sentences.length`: `DELETE` the surplus tail rows.
- Run updates in parallel with `Promise.all`; do inserts/deletes after so order_index stays consistent.
- `qc.invalidateQueries(["sentences", activeDocId])`.
- `await setIndex(finalIdx)`.
- `setEditing(false)`; clear `editText`.
- Done → `speak(sentences[finalIdx])`. Jump → same.

### Key/UX rules
- **Enter no longer commits** in this mode — it inserts a newline, because the user is editing a multi-paragraph document. Two consecutive newlines = sentence boundary.
- **Escape** cancels (no save), returns to previous view at the original `currentIdx`.
- **onBlur does NOT auto-commit** in this mode (would fire when the user taps Done/Jump To). Saving only happens via Done, Jump To, or Escape's explicit cancel.
- Orb gestures stay live but most do nothing visible while editing (focus is in textarea). We disable `onDoubleTap` while `editing` is true to avoid re-entering edit mode mid-edit.
- Toaster: on Done show `"Saved"`; on Jump To show `"Jumped"`. Both reuse the existing top toaster.

## Styling
- Textarea fills the central sentence area (the same vertical band currently used by the single-sentence view). Set `min-h-[60vh]`, `overflow-y-auto`, `font-display text-2xl md:text-3xl leading-snug`, `whitespace-pre-wrap`. Reduce font size from the current 3xl/4xl so multiple sentences fit comfortably.
- Buttons: reuse the exact pill/glow classes used by the New-idea Cancel/Send buttons (lines ~641–650). Order: `Done` left, `Jump To` right. Disable `Jump To` if `selectionStart` is null or doc is empty.

## Mobile-specific care (iPhone 16e, Chrome iOS / Safari iOS)
- On iOS, Chrome and Safari both share WebKit. The known footguns we handle:
    1. **Focus + caret placement in same gesture tick** — handled via ref-callback focus (already works for current single-sentence edit; same pattern reused).
    2. **Keyboard pushes viewport up** — the textarea uses `min-h-[60vh]` instead of a fixed full-screen height so the on-screen keyboard doesn't cause the buttons to disappear off-screen. Buttons sit above the orb, which is already absolutely positioned at the bottom; we'll switch the button container to `position: sticky; bottom: 0` *within the edit overlay* so they stay visible when the keyboard is up.
    3. **iOS Safari `scrollTop` on textarea** — works reliably; we set it inside a `requestAnimationFrame` after focus to ensure layout is settled.
    4. **Double-tap zoom** — already prevented by orb gesture handler. The textarea itself uses `font-size >= 16px` (our `text-2xl` is 24px) so iOS doesn't auto-zoom on focus.

## Files touched
- `src/routes/_authenticated/app.tsx` — rewrite the `editing` branch in the render, add `commitFullEdit(targetIdx)`, add a `caret-coord` helper (or inline ~25 lines), wire Done / Jump To buttons, gate `onDoubleTap` while editing.

No DB schema changes. No new dependencies. No gesture-map changes.

## Out of scope
- Real-time collaborative edits (single-user, last-write-wins is fine).
- Rich text / formatting.
- Undo for the bulk edit (Escape cancels before save; once Done is pressed, the change is committed).
