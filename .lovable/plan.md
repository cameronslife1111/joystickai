## Goal
Make the app feel native on mobile: orb + sentence always fit the screen (no scroll), no double-tap zoom, web speech actually fires on iOS, and add an MP4 export of a session.

## 1. Fit the whole UI to the device viewport (no scroll)

Problem: `min-h-screen` uses `100vh`, which on iOS Safari is the *largest* viewport (includes the URL bar), so content gets pushed off and the user has to scroll to see the orb.

- In `src/routes/_authenticated/app.tsx`, change the main wrapper from `min-h-screen` to a true viewport-locked container using `h-[100svh]` (small viewport height) with `overflow-hidden` and `overscroll-none`.
- Add the same treatment to `src/routes/index.tsx` and the root error/404 shells in `src/routes/__root.tsx`.
- Constrain the orb + sentence stack so it scales down on short screens:
  - Wrap orb in a container sized off `min(70vw, 60svh)` so it never exceeds either axis.
  - Cap the sentence area with `max-h-[30svh]` and switch internal text scrolling on only when content overflows.
- Add safe-area padding (`env(safe-area-inset-*)`) so the orb isn't hidden behind the iPhone home indicator.

## 2. Disable double-tap zoom and pinch zoom in-app

- Update the viewport meta in `src/routes/__root.tsx` to add `user-scalable=no` (alongside existing `maximum-scale=1`).
- In `src/styles.css`, add `touch-action: manipulation` globally on `html, body` (kills the 300ms double-tap zoom on iOS) and `touch-action: none` on the orb.
- Apply `touch-action: manipulation` to dialog/popover surfaces too so pop-ups don't zoom.

## 3. Fix web speech on iPhone (currently silent)

Root cause: iOS Safari only allows `speechSynthesis.speak()` when called *synchronously inside a user gesture*. Today the flow is:
- user taps orb →
- async Supabase calls / `setTimeout(..., 60)` / awaited fetches →
- *then* `new SpeechSynthesisUtterance` and `speak()`.

By the time `speak()` runs the gesture context is gone, so iOS silently drops it. Desktop has no such restriction, which is why it works there.

Fix:
- Add a one-time iOS unlock: on the very first `pointerdown` anywhere in the app, synchronously call `speechSynthesis.speak(new SpeechSynthesisUtterance(""))` to "prime" the engine, then remove the listener.
- Refactor `speak()` in `src/routes/_authenticated/app.tsx`:
  - Create the `SpeechSynthesisUtterance` object **synchronously** inside the gesture handler (orb tap / swipe handler) before any `await`.
  - Pass that pre-created utterance into the async flow; only update `utterance.text` after data loads, then call `speechSynthesis.speak(utterance)`.
  - Remove the `setTimeout(..., 60)` wrapper around `speak()` — replace the cancel/flush gap with `speechSynthesis.cancel()` immediately followed by `speak()` in the same tick (the delay is what kills it on iOS).
- Keep the mute check and emoji stripping intact.
- Keep the token-based race protection, but check the token *before* mutating utterance.text rather than wrapping the whole call in `setTimeout`.

## 4. MP4 export of the orb session

- Add a new menu entry "Export MP4".
- On tap, use `MediaRecorder` against `canvas.captureStream(30)` of a hidden canvas that mirrors the current orb + sentence frame-by-frame (via `requestAnimationFrame` painting the DOM area, or by recording the orb container with `html2canvas` frames composited onto the canvas).
- Record for a user-controlled duration (default 10s, configurable later); on stop, download a `.mp4` (Safari supports `video/mp4;codecs=avc1`, Chrome falls back to `video/webm` which we transmux client-side via `mp4-muxer` if needed).
- No backend changes.

Note: full-fidelity MP4 of a live DOM is non-trivial on the web. If `html2canvas`-per-frame proves too slow on mobile, fallback: record only the orb (it's a CSS animation we can repaint to canvas cheaply) and overlay the sentence text drawn directly on the canvas via `ctx.fillText`. I'll go with this fallback as the default to keep recording smooth on iPhone.

## Files touched
- `src/routes/_authenticated/app.tsx` — layout sizing, speech refactor, gesture-context utterance, export-MP4 button + recorder.
- `src/routes/__root.tsx` — viewport meta (`user-scalable=no`), iOS speech unlock listener inside `RootComponent`, safe-area shells.
- `src/routes/index.tsx` — `h-[100svh]` + safe area.
- `src/styles.css` — global `touch-action`, safe-area utilities, orb container sizing helpers.
- `package.json` — add `mp4-muxer` (and `html2canvas` only if needed for fallback frame capture).

## Out of scope
No backend / schema changes. Rename, mute, cycle-sync behavior stays as-is.

## Expected outcome
- iPhone shows orb + sentence centered, no scrolling required, no double-tap zoom.
- Tapping the orb actually speaks the sentence on iOS, matching desktop.
- New menu item produces a downloadable MP4 of the current session.
