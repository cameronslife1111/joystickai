## Goal

Fix two bugs with the long-press (move-to-bottom) action on the slot 24 ↕️ Move sentence button.

## Bug 1 — iOS text selection / callout on long press

On iPhone, holding the button triggers the native text-selection highlight (blue) and copy menu.

Fix in `MenuGridButton` (`src/routes/_authenticated/app.tsx`, ~lines 60-93):
- Add `select-none` to the button `className`.
- Add inline style to suppress the iOS callout/selection: `WebkitTouchCallout: "none"`, `WebkitUserSelect: "none"`, `userSelect: "none"`.
- Add `onContextMenu={(e) => e.preventDefault()}` to block the long-press context/callout menu.

This is presentation-only and applies to all menu buttons (harmless — they're action buttons, not selectable text).

## Bug 2 — view jumps to the moved sentence instead of advancing

Currently the long press calls `moveSentence(length - 1)`, which runs `setIndex(to)` and speaks the moved sentence — so the view follows the sentence to the bottom.

Desired: after sending the current sentence to the bottom, the view stays in place so the *next* sentence takes the current slot, becomes active, and is read aloud. Repeating creates an endless cycle.

Fix: add a dedicated handler (e.g. `moveCurrentToBottom`) used only by the long press, leaving the Move dialog's `moveSentence` unchanged:
- Capture `from = currentIdx`, `to = sentences.length - 1`; bail if already at/after bottom or list empty.
- Call the same `move_sentence` RPC (`p_from_index: from`, `p_to_index: to`).
- Do NOT call `setIndex(to)`. Keep the index at `from` (after the move, the sentence formerly at `from + 1` shifts into index `from`).
- Invalidate the `["sentences", activeDocId]` query.
- Speak the sentence now at the current index (the next one), using a fresh `claimSpeech()` token.
- Close the menu/move dialog as appropriate.

Then update the slot's `onLongPress` (~line 1781) to call `moveCurrentToBottom()` instead of `moveSentence(length - 1)`, and add `moveCurrentToBottom` to the grid `useMemo` dependency array.

## Scope

Frontend only in `src/routes/_authenticated/app.tsx`. No backend, schema, or business-logic changes. The Move dialog's existing "move to bottom" option keeps its current behavior.