# Red button becomes Recents; hold a sentence to delete it

## New behavior

| Where | Press | Hold |
| --- | --- | --- |
| Red tile (top left) | Opens Recent docs — the same list as "Recent docs" in the menu | Search docs (unchanged) |
| The sentence text | Opens edit mode (unchanged) | Deletes that sentence, with the usual undo notice |

Holding a sentence no longer starts voice recording. Voice ideas are still available by holding the yellow tile (New idea), which opens the composer with its own record button.

## Details

- The red tile keeps its style and gets the clock icon so it matches the menu's Recent docs entry. Its label becomes "Recent docs (hold to search docs)".
- Deleting by hold uses the exact same delete path the red button used before, so the undo notice and the move to the next sentence work the same.
- A hold on a sentence will not select text or pop up the iPhone copy menu; the existing press surface already blocks that.
- Tapping a link inside a sentence still opens the link.
- Nothing else changes: all other tiles, their holds, the menu, and keyboard arrows stay as they are.

## Technical notes

- `src/components/OrbCluster.tsx`: rename the red orb's props to `onRecents` / `onRecentsLongPress` (keeping the same tile position and `glow-orb-red` class), swap `Trash2` for `History`, update the label.
- `src/routes/_authenticated/app.tsx`:
  - Wire `onRecents={() => setRecentOpen(true)}` and keep the search overlay on its hold.
  - Replace `onLongPressStart` on the sentence surface with a delete action calling the existing `deleteCurrent()`; `onLongPressEnd` stays a no-op. Remove the recorder start/stop logic used only by that gesture (`recorderRef` toggle, `micStartingRef`, `setRecording` there) along with the now-unused `recording` glow on `.sentence-surface`, and drop `dispatchVoiceToComposer` only if nothing else calls it.
  - Update the surface `aria-label` to "Press to edit, hold to delete this sentence".
- `src/routes/index.tsx`: update the landing legend label for the red orb to "Recent docs / search".

## Verification

- Tap red: Recent docs list opens, same as from the menu; hold red: search opens.
- Hold a sentence: it deletes with an undo notice and the next sentence is read; tap still opens the editor.
- Holding a sentence never starts the microphone; yellow-hold New idea still records.
- Check on a phone-width view and on desktop.
