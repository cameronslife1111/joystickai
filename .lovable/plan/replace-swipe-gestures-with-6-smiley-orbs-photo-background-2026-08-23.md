# Replace swipe gestures with 6 smiley orbs + photo background

## The big picture

The big Orby in the middle of the home screen goes away. In its place: a cluster of 6 small glowing orbs (same 44px size as the current blue/green side orbs), each with a little smiley face, plus a transparent pressable pad in the very center. Every function that exists today keeps working — only the triggers change from swipes/taps-on-the-big-orb to button presses.

## New layout

```text
                 (blue · prev)
 (red · del) (yellow · menu) [center pad] (green · next doc) (orange · repeat)
                 (purple · next)
```

- **Blue (top)** → previous sentence (today's swipe-down function)
- **Purple (bottom)** → next sentence (today's swipe-up function)
- **Yellow (inner left)** → open the menu (today's swipe-left)
- **Green (inner right)** → cycle to next document (today's swipe-right, unchanged — favorites cycle, linked-doc jump, locked-list behavior all stay)
- **Red (outer left)** → delete sentence (today's blue side orb, recolored)
- **Orange (outer right)** → repeat sentence (today's green side orb, recolored)
- **Center pad** — fully transparent (the photo background shows through it):
  - Single press → open edit mode (today's orb tap)
  - Long press → start recording with the red glow; second long press stops and transcribes into New Idea (today's orb long-press, unchanged)

## Details

1. **New `OrbCluster` component** (`src/components/OrbCluster.tsx`) rendering the 6 buttons and the center pad in the arrangement above, sized to fit a phone screen (gaps shrink on narrow viewports). Each orb shows a small smiley face (tiny SVG eyes + smile, legible on every glow color).
2. **Press animation ("giggle")**: pressing any orb plays a quick, soundless jiggle (a short rotate/translate keyframe, ~400 ms, retriggerable on every press). Disabled under `prefers-reduced-motion`.
3. **New colors in `src/styles.css`**: add `glow-orb-red`, `glow-orb-orange`, `glow-orb-purple`, `glow-orb-yellow` utilities alongside the existing green/blue; add the giggle keyframes and cluster layout CSS. The recording red glow moves from the old big-orb aura to a red pulsing ring around the center pad.
4. **Rewire `src/routes/_authenticated/app.tsx`**:
   - Replace the orb stage (big `Orb` / `DocumentIconAvatar`, aura, solar flares) with `OrbCluster`.
   - Navigation orbs are plain buttons calling the existing handlers (`onSwipeUp`, `advanceSentence`, `setMenuOpen`, `onSwipeRight`, `deleteCurrent`, repeat) — no gesture code involved.
   - The center pad keeps `useOrbGestures`, but only for tap/long-press; swipe handling is removed from the call site. The spacebar shortcut (new idea / edit) stays as-is.
   - Editing mode still hides the cluster and pins Done / Jump to top at the bottom, exactly as today.
5. **Photo background replaces "Set as document icon"**:
   - Migration: add `background_media_asset_id` (nullable, references media_assets) to `user_preferences`; regenerate types. (Column change only — the table's existing grants/RLS already cover it.)
   - In the media gallery action sheet, "Set as document icon" becomes **"Set as background"** (one tap sets it, no document picker) plus a **"Remove background"** option when one is set. The old `AssignDocumentIconDialog` flow is removed; the `document_icons` table is left untouched.
   - The background renders as a fixed, full-screen image layer behind the app (in the authenticated layout so it shows on home and media screens): the image fades out smoothly toward the top via a mask gradient, and a soft theme-colored scrim sits over it so sentence text, the editor, and dialogs stay perfectly readable in both light and dark mode. The transparent center pad lets the photo show through the middle of the cluster.
   - Since the big orb is gone, the per-document icon display on the home screen (`docIconUrl` / `DocumentIconAvatar` in the orb stage) is removed with it.

## Verification

- Build log clean; run existing tests.
- Playwright pass on the preview: press each of the 6 orbs and confirm prev / next / menu / next-document / delete-with-undo / repeat all behave exactly as the current gestures do; single-press center opens the editor; long-press center glows red, records, and a second long-press transcribes into New Idea; the giggle animation fires on press.
- Set an image as background from the media gallery and confirm the home screen shows it with the top fade and readable text, in both light and dark mode; remove it and confirm the plain background returns.

## Files to change

- `src/components/OrbCluster.tsx` (new)
- `src/routes/_authenticated/app.tsx` (swap orb stage for cluster, remove icon/flare wiring)
- `src/routes/_authenticated.tsx` (background layer)
- `src/routes/_authenticated/media.tsx` (action sheet: Set as / Remove background)
- `src/components/AssignDocumentIconDialog.tsx` (removed)
- `src/styles.css` (colors, smiley, giggle, cluster, recording ring, background scrim)
- New migration for `user_preferences.background_media_asset_id` + regenerated types

## Out of scope

No changes to any underlying function (navigation, favorites cycling, recording, transcription, undo). No changes to chat, plans, slots, or media generation. The landing-page Orb component stays as-is.
