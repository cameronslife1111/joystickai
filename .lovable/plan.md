# Rearrange the orb cluster and add two new orbs

## New layout

```text
   red        [ ]     blue      [ ]      orange
   [ ]      yellow   center    green      [ ]
   pink       [ ]     purple    [ ]       gray
```

- Red (delete) and orange (pinned doc) move up to the top row, level with blue.
- Pink orb is added bottom-left, level with purple.
- Gray orb is added bottom-right, level with purple.
- Center pad keeps its exact current size and gestures (tap = edit, hold = record).

## Pink orb — Move sentence / Jump to toggle

- Starts in Move mode with an up/down arrow icon. Tap opens the same "↕️ Move sentence" sheet as menu slot 6.
- Long press (same ~500 ms hold used by the orange orb) flips the orb into Jump mode: the icon becomes a letter **J**, and a tap then opens the same "🔃 Jump to" sheet as slot 12.
- Long press again flips back to Move mode with the arrow icon. A short toast confirms the switch so the mode is never ambiguous.
- The mode stays where you left it while the app is open, and the long press never also fires the tap action.

## Gray orb — Media gallery

- Tap opens the media gallery, identical to the menu's 🖼️ Media Gallery item.
- Shows the same unseen-media count the menu badge uses, as a small dot/count on the orb.
- No long-press action.

## Unchanged

- Slots 6 and 12 in the menu keep working exactly as they do now, including their long presses (move to bottom, jump to top).
- Blue, purple, yellow, green, red, orange behavior; keyboard arrow navigation; speech; center pad.

## Homepage legend

The homepage cluster diagram gains the two new orbs in the same positions with labels "Move sentence / Jump to" (pink) and "Media gallery" (gray), and red/orange move to the top row so the legend matches the app.

## Technical details

- `src/styles.css`: add `@utility glow-orb-pink` and `@utility glow-orb-gray` color tokens next to the existing ones; no grid change needed (the 5x3 grid already has the empty cells).
- `src/components/OrbCluster.tsx`: reposition red to `{col 1, row 1}` and orange to `{col 5, row 1}`; add pink at `{col 1, row 3}` and gray at `{col 5, row 3}`. New props: `moveMode: "move" | "jump"`, `onMoveJump`, `onMoveJumpLongPress`, `onMediaGallery`, `mediaBadge?: number`. Pink icon = `ArrowUpDown` in move mode; in jump mode render a bold `J` glyph in place of the icon (same `glow-orb-icon` sizing). Gray icon = `Image` from lucide-react. Badge is an absolutely positioned span on the gray button.
- `src/routes/_authenticated/app.tsx`: add `const [pinkMode, setPinkMode] = useState<"move" | "jump">("move")`; wire pink tap to `setMoveOpen(true)` / `setJumpOpen(true)` per mode, long press to toggle mode + `toast`; wire gray to `navigate({ to: "/media" })` and pass `unseenCount`. Update the cluster comment.
- `src/components/LandingOrb.tsx`: add `pink` and `gray` to `OrbColor`/`ORB_HEX` and their icons (`ArrowUpDown`, `Image`).
- `src/routes/index.tsx`: update `CLUSTER` positions/labels for the six existing orbs plus the two new entries.

## Verification

Playwright check on the home screen: confirm the eight orbs render in the new positions without overlap at 390px width, the pink orb opens the Move sheet, a long press swaps it to the J icon and then opens the Jump sheet, and the gray orb navigates to the media gallery.
