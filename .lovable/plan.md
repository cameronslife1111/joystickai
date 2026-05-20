
# Bring Orby to life with a face & mood

Give Orby a simple SVG face (two eyes + mouth) layered on top of the existing orb, plus a mood system that brightens with use and slowly fades to gray sleep after 5 minutes of inactivity. Purely visual — no audio, no behavior changes, all existing gestures and functions keep working unchanged.

## Visual design

- Two small circular eyes + a single mouth path, rendered as an inline SVG overlay inside `Orb` (above `.orb-highlight`). Pointer-events: none so taps still hit the orb button.
- Eyes blink occasionally (every 4–7s, randomized) via a quick scaleY animation.
- Subtle eye drift (look around) every few seconds for "alive" feel.
- Mouth shape is a single SVG `path` whose `d` is interpolated by mood (frown → neutral → smile → big smile).

## Mood model

Mood is a single number `mood` in `[0, 1]` (0 = asleep/sad, 1 = happiest), held in state inside `Orb` via a new `useOrbMood` hook.

- **Boosts (instant):** each swipe gesture (up/down/left/right) adds `+0.15`, clamped to `1.0`. Taps do not boost (user said "any swipe gesture").
- **Decay:** linear decay from `1 → 0` over 5 minutes of no swipes. Implemented with a `lastInteractionAt` timestamp + `requestAnimationFrame` loop (throttled to ~4fps) computing `mood = max(0, 1 - elapsedMs / 300_000)`.
- **Sleep state:** when `mood === 0`, eyes close (mouth small flat line), face desaturates fully, "Zzz" is NOT added (keep it simple — just closed eyes + gray).

## Color & expression mapping

Driven by `mood` via CSS custom properties set on the orb root:

```text
mood 1.0  →  vibrant aurora (current colors), big smile, wide eyes
mood 0.7  →  current colors, smile
mood 0.5  →  neutral mouth, slight desaturation
mood 0.3  →  frown, hue shifts toward red/brown (mix aurora with #8B4513)
mood 0.1  →  deep red-brown, sad frown, droopy eyes
mood 0.0  →  full gray (saturate(0)), closed eyes, asleep
```

Implementation: set `--orb-mood: <0..1>` and `--orb-tint` (interpolated color) on the orb element. Use `filter: saturate() hue-rotate()` on `.orb-core` / `.orb-aurora` driven by `--orb-mood`. Mouth `d` and eye `ry` are computed in React from `mood`.

## Interaction wiring

In `src/hooks/use-orb-gestures.ts`: no signature change. In `Orb.tsx`: accept an optional `onActivity?: () => void` prop OR (simpler) expose a `boostMood(amount)` via a forwarded imperative handle. Cleanest: lift mood into a small `useOrbMood()` hook in `src/hooks/use-orb-mood.ts`, return `{ mood, boost, registerActivity }`. `Orb` consumes it internally for rendering; `app.tsx` calls `boost()` inside its existing `onSwipe` handler (one line addition — no behavior change).

For the Landing page orb (`src/routes/index.tsx`), the face renders too but has no input — it just sits at full happiness with idle blinks/drift.

## Files to change

- `src/components/Orb.tsx` — add SVG face overlay, consume mood, apply CSS vars + filters.
- `src/hooks/use-orb-mood.ts` — NEW. Mood state, decay loop, boost API, blink/drift timers.
- `src/styles.css` — add `.orb-face` styles, `--orb-mood`/`--orb-tint` defaults, mood-driven filter on `.orb-core`/`.orb-aurora`, mouth/eye transitions.
- `src/routes/_authenticated/app.tsx` — in the existing `onSwipe` callback inside `useOrbGestures`, call `orbRef.current?.boostMood?.()`. No other logic touched.

## Technical notes

- All mood timers live inside `Orb` / `useOrbMood`. No new global state, no DB, no network.
- Use `forwardRef` with `useImperativeHandle` to expose `boostMood()` on the existing `orbRef` so app.tsx doesn't need new refs.
- All gesture callbacks remain pure pass-throughs; `listening`/`thinking` orb states still override mood-driven animation speed (e.g. `orb-thinking` keeps spin).
- Mood persists in `sessionStorage` so a quick reload doesn't reset to full — keeps the "alive" illusion.
- Respects `prefers-reduced-motion`: disables blink/drift, keeps color transitions.

## Out of scope

- No sound, no "Zzz" particles, no haptics.
- No changes to gesture detection, speech, plans, or any other feature.
- Tap, long-press, double/triple tap do not change mood (only swipes, per request).
