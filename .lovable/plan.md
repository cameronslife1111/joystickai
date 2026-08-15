# Add more move-distance options to the Move sentence popup

Slot 6 opens a "↕️ Move sentence" popup that currently offers:
- Move to top
- Move up 2
- Move up 1
- Send to document
- Move down 1
- Move down 2
- Move to bottom

Add the missing intermediate distances so the user can jump a sentence further in either direction:
- Move up 3
- Move up 4
- Move up 5
- Move down 3
- Move down 4
- Move down 5

## Technical details

- File to change: `src/routes/_authenticated/app.tsx` around the Move sentence sheet (currently lines ~3521–3558).
- The sheet renders two mapped arrays of `{ label, target, disabled }` objects. Insert the new options in the natural order:
  - Above "Move up 1": add Move up 5, 4, 3, 2 (descending distance, ascending position).
  - Below "Move down 1": add Move down 2, 3, 4, 5 (ascending distance, descending position).
- Use the existing emoji style (e.g. ⏫ for up 2, 🔼 for up 1). For the new distances, pick consistent arrows:
  - Up 3/4/5: keep using ⏫ or a double-arrow variant.
  - Down 3/4/5: keep using ⏬ or a double-arrow variant.
- Disabled logic:
  - `move up N`: disabled when `currentIdx < N`.
  - `move down N`: disabled when `currentIdx >= sentences.length - N`.
- The existing `moveSentence(to)` function clamps the target and lands on the sentence that followed the moved one, so no backend or navigation changes are needed.

## Out of scope

- No changes to the `move_sentence` RPC, sentence ordering, or speech landing behavior.
- No changes to the "Send to document" button.
