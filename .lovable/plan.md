## Re-speak at boundaries + Jump-to menu

### 1. Re-trigger TTS at document boundaries
In `src/routes/_authenticated/app.tsx`:
- **`onTap`**: when `currentIdx + 1 >= sentences.length`, keep the "End of document" toast but also call `speak(currentSentence.content)` so each tap re-reads the last sentence.
- **`onSwipeUp`**: when `currentIdx === 0`, keep the "Start of document" toast but also call `speak(sentences[0].content)` so each swipe-up re-reads the first sentence.

### 2. New "Jump to" menu entry
- Add a menu tile: `{ e: "🔃", t: "Jump to", fn: () => { setMenuOpen(false); setJumpOpen(true); } }`.
- New state: `const [jumpOpen, setJumpOpen] = useState(false);`
- New helper `jumpTo(target: number)` that:
  - Clamps `target` to `[0, sentences.length - 1]`.
  - Calls `setIndex(clamped)`.
  - Calls `speak(sentences[clamped].content)`.
  - Closes the sheet.
- New vertical sheet overlay (same visual language as menu / favorites overlays) with 6 stacked full-width buttons, top → bottom:
  1. ⤒ Jump to top  → `jumpTo(0)`
  2. ⏪ Jump back 10  → `jumpTo(currentIdx - 10)`
  3. ◀ Jump back 5   → `jumpTo(currentIdx - 5)`
  4. ▶ Jump ahead 5  → `jumpTo(currentIdx + 5)`
  5. ⏩ Jump ahead 10 → `jumpTo(currentIdx + 10)`
  6. ⤓ Jump to end   → `jumpTo(sentences.length - 1)`
- Disable the sheet's buttons if `sentences` is empty.
- Tapping outside the sheet or a Close button dismisses it.

### Out of scope
- Custom "jump N" input.
- Persisting last jump.
- Keyboard shortcuts.
