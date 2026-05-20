# Lip-sync Orby's mouth to speech

Goal: when the Web Speech `speak()` function is talking, Orby's mouth opens and closes in rough sync with the audio. Not phoneme-accurate — just an "alive" jaw-flap that starts/stops with the utterance.

## Approach

Keep it lightweight by listening to the **global** `window.speechSynthesis` state instead of wiring every `speak()` call site (there are 15+ in `app.tsx`). One small polling loop drives a shared `talking` flag, and the orb's mouth geometry interpolates open/close from that flag.

No changes to any `speak()` call site, no new dependencies, no per-utterance plumbing.

## Changes

### 1. `src/hooks/use-orb-mood.ts`
- Add a `talking` boolean to the returned state.
- Start a low-cost interval (~80ms) that reads `window.speechSynthesis.speaking`. The interval only runs while the page is visible; otherwise idle.
- Also expose a `mouthOpen` number (0–1) generated while `talking` is true: a fast sine + small random jitter so the mouth flaps naturally rather than ticking on/off. When not talking, `mouthOpen` decays to 0 quickly.

### 2. `src/components/Orb.tsx`
- Consume `talking` and `mouthOpen` from `useOrbMood`.
- Replace the mouth `path` with a geometry that interpolates between:
  - **Closed/expression line** (current frown↔smile curve driven by mood) when `mouthOpen ≈ 0`
  - **Open oval** (a small filled ellipse, height scaled by `mouthOpen * ~6px`) when talking
- Keep the smile curvature from mood — when talking + happy, the mouth opens upward like a grin; when talking + sad, it stays flatter. Implementation: render an ellipse with `ry = baseLineThickness + mouthOpen * openAmount`, vertically centered on the existing mouth Y, and keep the curved path underneath as the "lip line" so the resting expression still shows through.
- Asleep state overrides: no mouth movement even if `speechSynthesis.speaking` is true (Orby's not awake to talk).

### 3. No changes to `app.tsx`, `__root.tsx`, or any `speak()` callers
The global polling approach means every existing and future `speak()` call automatically animates the mouth.

## Technical notes

- Polling at 80ms = 12.5 reads/sec of a synchronous boolean — negligible cost, far cheaper than wiring `onstart`/`onend` to every utterance and dealing with the iOS Safari quirks already documented in `app.tsx`.
- `mouthOpen` is computed inside the same interval (no extra rAF loop). Sine driver: `0.5 + 0.5 * Math.sin(t * 18)` plus `Math.random() * 0.15`, clamped 0–1.
- Respects `prefers-reduced-motion`: when set, mouth just toggles between closed and a single fixed open height instead of oscillating.
- Stops cleanly when `speechSynthesis.speaking` flips false — `mouthOpen` snaps to 0 within one tick.

## Out of scope
- Phoneme/viseme matching (would need an audio-analysis lib or per-utterance `onboundary` events, much heavier).
- Lip-sync for media-gallery video playback (separate concern).
