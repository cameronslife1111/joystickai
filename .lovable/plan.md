# Copy slot rework and a new theme popup

## Slot 8 becomes Copy

- Slot 8 is now "Copy sentence" (clipboard emoji). A single press copies just the sentence you're on and shows a short toast: "Copied sentence".
- Holding slot 8 copies the whole document instead, with a blank line between each sentence, and toasts "Copied document".
- If there's nothing to copy you get a small "No sentence to copy" / "Document is empty" toast instead.

## The theme button opens a small popup

Pressing the theme button (slot 1) no longer flips light/dark straight away. It opens a small settings popup with two rows:

1. **Appearance** — Light / Dark, saved exactly as it is today.
2. **Pressing a sentence** — two choices:
   - **Open the full editor** (what happens today: the whole document opens for editing).
   - **Quick edit this sentence** (new): pressing the sentence turns just that sentence into a small editable box in place. Press Enter or Done to save; Escape or Cancel discards. If what you typed contains more than one sentence it is split on periods, question marks and exclamation marks and the pieces are inserted right where that sentence was. After saving, Orby reads the sentence back to you.

The choice is remembered on this device. Holding the sentence to record a voice idea keeps working in both modes.

## Technical notes

All in `src/routes/_authenticated/app.tsx` unless noted.

- Slot 8: replace `filled[7] = grid[13]` with a new entry `{ e: "📋", t: "Copy sentence", fn: copyCurrentSentence, onLongPress: copyWholeDocument }`. `copyWholeDocument` reuses the existing grid[13] logic but joins with `"\n\n"`; both keep `copyToClipboard` + the emoji toasts. The menu grid button already supports `onLongPress`.
- New state: `themeSheetOpen`, and `tapMode: "editor" | "sentence"` initialised from `localStorage["orby_tap_mode"]` (default `"editor"`), persisted on change.
- Slot 1 handler becomes `() => { setMenuOpen(false); setThemeSheetOpen(true); }`. New popup rendered near the existing Sound settings dialog, styled to match it: Light/Dark segmented control calling `saveTheme`, plus a two-option segmented control for tap mode.
- `onDoubleTap` branches on `tapMode`: `"editor"` keeps today's behaviour; `"sentence"` sets `quickEditText` to `currentSentence.content` and `quickEditing = true` (no full-doc `editing`, so navigation locks stay as-is via a small addition to the same `editingRef` guard).
- Quick-edit UI replaces the read-mode sentence block with a `textarea` in the same typography, autofocused, caret at end. `Enter` (without shift) or the Done button commits; `Escape`/Cancel exits.
- Commit path: build the full contents array from `sentences`, replacing the current index with `parseEditParts(quickEditText)` (empty → sentence removed), then call the existing `supabase.rpc("commit_document_edit", { p_document_id, p_contents })`, invalidate `["sentences", docId]`, `setIndex` to the first inserted part, and `speak` it with a fresh `claimSpeech()` token. Errors surface the existing "Couldn't save edits" toast and keep the box open.
- iPhone: the quick-edit textarea inherits the existing `sentence-surface` container rules; `touch-action` is relaxed on the textarea itself so the caret works.

## Verification

Typecheck plus the build log; then in the preview: slot 8 press/hold toasts, theme popup switches light/dark, and in quick-edit mode a tap on the sentence edits in place, splits multi-sentence input, and reads back the result.
