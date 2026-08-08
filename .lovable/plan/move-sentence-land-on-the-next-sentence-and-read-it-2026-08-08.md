# Move sentence: land on the next sentence and read it

Today, after moving a sentence up or down, the app follows the moved sentence to its new position and reads it again. Instead, it should stay in place in the reading flow: jump to whatever sentence came right after the one that was moved, and read that sentence out loud.

## Behavior

- Move up 1, Move up 2, Move to top: after the move, the app lands on the sentence that used to follow the moved one and speaks it.
- Move down 1, Move down 2, Move to bottom: same — the next sentence slides into the current slot, so the app stays there and speaks it. (Move to bottom already behaves this way; it stays as-is.)
- If the moved sentence was the last one in the list, the app lands on the final sentence of the list and reads that, rather than doing nothing.
- Send to a different document: unchanged — the user stays on the current document and continues with the next sentence, which already happens.

## Technical notes

In `src/routes/_authenticated/app.tsx`, `moveSentence` currently calls `setIndex(to)` and speaks the moved sentence. Replace that with next-sentence targeting based on the pre-move list:

- Capture `nextContent = sentences[from + 1]?.content` before the move.
- Resulting index for the next sentence: `from` when moving down (`to > from`), `from + 1` when moving up (`to < from`); clamp to `sentences.length - 1`.
- When there is no `from + 1` (moved the last sentence), target the clamped last index and speak the content now at that index.
- Keep the existing `claimSpeech()` token, `persistIndex`-backed `setIndex`, and the `sentences` query invalidation so position saving and speech cancellation stay correct.
