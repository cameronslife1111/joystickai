# Rebuild the control cluster as gapless tiles, move tap/hold to the sentence

## New layout

```text
 ┌────────┬──────────────┬────────┐
 │  red   │              │ orange │
 ├────────┤     blue     ├────────┤
 │ yellow │  (previous)  │ green  │
 ├────────┼──────────────┼────────┤
 │        │    purple    │        │
 │  pink  │    (next)    │  gray  │
 └────────┴──────────────┴────────┘
```

- Left column top to bottom: red (delete), yellow (menu), pink (jump to).
- Right column top to bottom: orange (pinned doc), green (next document), gray (media gallery).
- The entire middle column is split in half: blue (previous sentence) on top, purple (next sentence) on the bottom — much larger targets than today.
- Rounded rectangles instead of circles, no gaps between them, so the whole block is one continuous control surface.
- Every tap and hold action stays exactly as it is today, including the hold actions on all eight tiles and keyboard arrow navigation.

## Tap and hold move to the sentence

The transparent center pad disappears (the middle is now blue/purple). Its two gestures move onto the sentence text itself:

- Single press on the sentence opens the full-document editor.
- Long press on the sentence starts/stops voice recording, with the same red pulsing glow — now drawn as a soft red ring around the sentence area — and the transcription still lands in the New idea flow.
- iPhone specifics: text selection, the long-press copy/callout menu, drag, and the right-click menu are all suppressed on that surface, and the tap highlight is removed.
- Links inside a sentence keep working: a press that starts on a link is ignored by the gesture layer and opens the link as before.

## Spacing

The cluster block gets a little taller and the sentence area's bottom padding shrinks slightly, so the top row starts higher and the sentence gets more vertical room without crowding the header.

## Technical notes

- `src/styles.css`
  - `.orb-cluster` becomes a 3-column / 6-row grid: `grid-template-columns: minmax(0,1fr) minmax(0,1.5fr) minmax(0,1fr)`, six equal rows, `gap: 0`, fixed block height via `clamp()` so it scales on small phones.
  - Inside the cluster, `.glow-orb` is overridden to `width:100%; height:100%; border-radius: 16px` and its scale-based pulse is swapped for an opacity-only pulse (`orb-tile-pulse`) so neighbouring tiles never overlap. The `:active` press feedback keeps a subtler `scale(0.97)`.
  - Replace `.orb-cluster-center` / `.orb-recording` with `.sentence-surface` and `.sentence-recording`: rounded box, `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none`, `-webkit-tap-highlight-color: transparent`, plus the existing red pulse keyframes retargeted to it.
- `src/components/OrbCluster.tsx`
  - Drop the `centerRef` and `recording` props and the center `<div>`; keep `pressRef`, all press/long-press props, the badge, `lockFavorites`, and the giggle/long-press logic unchanged.
  - New placements: red `{col 1, row 1-2}`, yellow `{1, 3-4}`, pink `{1, 5-6}`, blue `{2, 1-3}`, purple `{2, 4-6}`, orange `{3, 1-2}`, green `{3, 3-4}`, gray `{3, 5-6}`.
- `src/hooks/use-orb-gestures.ts`
  - Add an optional `ignoreSelector` option; `onPointerDown` / `onMouseDown` / `onTouchStart` return early when `target.closest(ignoreSelector)` matches (used with `"a"` so links still work).
- `src/routes/_authenticated/app.tsx`
  - Rename `centerRef` usage: the ref now attaches to a new wrapper `<div>` around the read-mode sentence `<p>`, with `className="sentence-surface"` plus `sentence-recording` while `recording`, and `useOrbGestures(..., { rebindKey: editing ? "edit" : "read", ignoreSelector: "a" })`.
  - Remove `centerRef` / `recording` from the `<OrbCluster>` call and update the layout comment; trim the cluster section padding.
- `src/routes/index.tsx` + `src/components/LandingOrb.tsx`
  - Update the homepage legend cluster so the diagram matches the new three-column tile arrangement and labels.

## Verification

Playwright at 390px width: confirm the eight tiles tile the block with no gaps and no overlap, each tap fires its handler, a hold on each fires its secondary action, a tap on the sentence opens the editor, and a hold on the sentence starts recording with the red ring. Then `bunx tsgo --noEmit` and the build log.

## Out of scope

No changes to what any button does, to the menu, or to recording/transcription behaviour.
