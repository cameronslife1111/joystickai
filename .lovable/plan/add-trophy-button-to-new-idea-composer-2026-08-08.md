# Add trophy button to New Idea composer

## What we're changing

Add a new floating trophy (🏆) button to the New Idea page (slot 13 / composer view). The button sits just above the existing red-circle voice dictation button. Pressing it prepends a trophy emoji to the beginning of the text in the New Idea textarea. If the textarea is empty, it inserts a single trophy emoji.

No other behavior changes: it does not submit, move, or transform the text.

## Files to change

- `src/routes/_authenticated/app.tsx`
  - Add a second floating button alongside the existing 🔴 dictation button (only visible while `composing` is true).
  - Position it directly above the red-circle button.
  - On press, update `composeText` to `"🏆 " + text` (with a trailing space so the user can keep typing), or `"🏆"` if the field is empty.

## Out of scope

- No changes to the red-circle dictation button behavior.
- No changes to slot 13's menu grid entry itself.
- No changes to send/save logic.
