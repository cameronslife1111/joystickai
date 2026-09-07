# Fix quick-edit mode: spacebar, read-back, and button placement

## What changes

1. **Space no longer opens New Idea while quick-editing.** Typing a space at the end (or anywhere) of the sentence you're quick-editing just types a space. New Idea keeps working exactly as before from the yellow button hold, slot 13, and the spacebar when you're not editing.
2. **Adding text before or behind the sentence works.** Whatever you type is split on periods, question marks and exclamation marks when you press Done, and the pieces are inserted where that sentence was.
3. **After Done, Orby reads the first of those sentences.** Press Done (or Enter) and it saves, then immediately reads the first sentence of what you just wrote.
4. **Cancel and Done sit lower**, just above the blue tile, instead of floating right under the text.

## Technical notes

All in `src/routes/_authenticated/app.tsx`.

- `busyRef.current` (line 897) currently lists `editing` but not `quickEditing`; add `quickEditing ||` so both keyboard handlers treat quick-edit as busy. Also harden the spacebar effect (line 1644): copy the target guard from the orb-key handler — return early when the event target is an `INPUT`/`TEXTAREA`/`SELECT` or `isContentEditable` — so no future field can trigger New Idea. `openNewIdea` itself is untouched, so the yellow-tile hold and slot 13 behave as today.
- `commitQuickEdit` (line 1845) already splices `parseEditParts(quickEditText)` into the contents at the edited index; change the spoken target to always be the **first** inserted part: keep `setIndex(idx)` clamped to the new list length and speak `contents[idx]` (which is `parts[0]`) with a fresh `claimSpeech()` token. Remove the early-return short-circuit's dependence on trimmed equality only when parts are unchanged, so multi-sentence input never skips the save/read path.
- Quick-edit button row (line ~2929): move the `Cancel` / `Done` row out of the text block and render it at the bottom of the sentence section, directly above the tile cluster (`mt-auto pb-2` inside the flex column that holds the sentence), keeping the same pill styling.

## Verification

Typecheck plus the build log, then in the preview: enter quick-edit mode, type a space at the end of the sentence (no New Idea popup), add a sentence before and after, press Done and confirm the first sentence is read back, and check the buttons sit near the blue tile.
