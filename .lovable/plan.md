## Goal

Kill the top-down aurora. Make the background pure white (light) / pure black (dark). Move all color/energy into a large, glowing, pulsing aura *around Orby itself*, and on swipe fire a dramatic directional "solar flare" in the swipe direction using Orby's current colors. Sentence text always renders above the aura. All gestures keep working, including when Orby is replaced by an uploaded image or the smiling face.

## 1. Background — strip the top-down aurora

`src/routes/_authenticated/app.tsx` (around lines 1943–1949):
- Remove `<div className="app-aurora" />` and the big blurred radial `<div>` below it.
- Keep only `<div className="absolute inset-0 bg-background" />` so the background is a flat theme color.

`src/styles.css`:
- Set `--background` to pure white in `:root.light` variant (`oklch(1 0 0)`) and pure black in the default dark `:root` (`oklch(0 0 0)`). Leave `--foreground` readable (near-white on dark, near-black on light).
- Delete the `.app-aurora` block and its `@keyframes app-aurora-hue` / `app-aurora-drift` rules — no other file references them (verified by grep).

## 2. New orb aura — big, alive, pulsing

New wrapper element rendered *behind* the orb button, centered on the orb, in `src/routes/_authenticated/app.tsx` right where `<Orb />` / `<DocumentIconAvatar />` are rendered (around line 2150–2210). Structure:

```text
<div class="orb-stage">           // positioning + isolation, z-0
  <div class="orb-aura" />        // huge pulsing aurora, z-0
  <div class="orb-flare" data-dir="up|down|left|right" />  // one-shot flare, z-1
  <Orb /> or <DocumentIconAvatar />   // z-2, unchanged ref/gestures
</div>
```

Sentence/header/menu text stays in its existing DOM position with higher stacking (they're already above via normal flow / z-index), so the aura sits behind text.

`src/styles.css` additions:
- `.orb-stage` — relative, `isolation: isolate`, sized to the orb; centers children.
- `.orb-aura` — `position:absolute; inset:-120%;` (≈2.5× orb diameter), `border-radius:9999px`, layered gradients using existing `--aurora-1..4` tokens, `filter: blur(60px) saturate(1.4)`, `mix-blend-mode: screen` on dark / `multiply` on light so it reads on both. Two stacked pseudo-elements for parallax drift:
  - `::before` conic gradient rotating slowly (`orb-aura-spin 18s linear infinite`).
  - `::after` radial gradient breathing (`orb-aura-pulse 4.5s ease-in-out infinite`) that scales 0.9↔1.15 and shifts opacity 0.55↔0.9.
- Hue drift via `@keyframes orb-aura-hue` rotating `hue-rotate(0→360deg)` over ~20s applied to the wrapper filter.
- Respect `@media (prefers-reduced-motion: reduce)` — freeze the rotations, keep a gentle opacity pulse only.

## 3. Directional solar-flare on swipe

`.orb-flare` is normally `opacity:0`. On swipe we toggle a data attribute + a "playing" class to trigger a one-shot keyframe, then clear it when the animation ends.

Four keyframes (`orb-flare-up/down/left/right`), each ~700ms `cubic-bezier(.22,.61,.36,1)`:
- Start: `scale(0.6)`, `opacity: 0`, no translate, tight blur.
- Mid (~30%): `opacity: 1`, blur increases, elongates along axis via `scaleX/scaleY` (e.g. up = `scaleY(1.8) scaleX(0.9)`).
- End: translate ~55vh in the direction, opacity back to 0.
- Background inherits Orby's current aura gradient (uses the same `--aurora-*` tokens + current `hue-rotate` via CSS var `--orb-hue`), so the flare color matches whatever the aura is at that moment.

Wiring in `src/routes/_authenticated/app.tsx`:
- `const [flare, setFlare] = useState<null | "up"|"down"|"left"|"right">(null);`
- In the `onSwipe` handler already at line 1068, call `setFlare(dir)` *before* the existing branch logic. Keep all gesture behavior identical.
- The `.orb-flare` element listens to `onAnimationEnd={() => setFlare(null)}` so back-to-back swipes always retrigger cleanly.
- Rendered only when `flare` is non-null, with `className={`orb-flare orb-flare-${flare}`}`.

This is pure CSS + one state boolean → no layout thrash, no impact on the pointer capture in `use-orb-gestures.ts`. Gestures continue to work for `Orb`, `DocumentIconAvatar`, and the smiling face path (they all share `orbRef` + `rebindKey`).

## 4. Text always above the aura

Verified the header (line 1972) and sentence area render in normal flow after the background layer. To be safe: add `relative z-10` to the `<header>` and the sentence container, and give `.orb-stage` an explicit `z-0`. No text component changes needed.

## 5. Performance + safety

- All animations are pure CSS transforms/opacity/filter — GPU-composited, no JS rAF loop, no re-renders on frame.
- Only one small React state (`flare`) updates per swipe; cleared on `animationend`.
- No changes to `useOrbGestures`, `use-orb-mood`, `Orb.tsx`, `DocumentIconAvatar.tsx`, or the pointer capture logic → swipes, taps, long-press, double-tap, invisible side zones, and image-avatar rebinding all keep working.
- `prefers-reduced-motion` shortens/disables spin + flare translate.

## Files touched

- `src/styles.css` — remove `.app-aurora` + keyframes; set pure black/white backgrounds; add `.orb-stage`, `.orb-aura`, `.orb-flare*` rules and keyframes.
- `src/routes/_authenticated/app.tsx` — remove aurora divs, wrap orb render in `.orb-stage` with `.orb-aura` + conditional `.orb-flare`, add `flare` state, trigger it in `onSwipe`.

No DB, no server function, no gesture-hook, no Orb/Avatar component changes.
