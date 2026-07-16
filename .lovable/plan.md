## Fix

In `src/routes/_authenticated/app.tsx`, the gesture hook's `onSwipe` callback (around line 1069) currently fires for all directions regardless of mode. When `editing === true` (full-document edit view with Done + Jump-to), swipes on the orb should be ignored so the user can't accidentally cycle documents/sentences while editing.

### Change

Update the `onSwipe` handler to bail out early when `editing` is true:

```ts
onSwipe: (dir) => {
  if (editing) return; // disable all swipes while in edit mode
  if (dir === "up") ...
  else if (dir === "down") ...
  else if (dir === "left") ...
  else if (dir === "right") void onSwipeRight();
},
```

Also add `editing` to the `useOrbGestures` options' `rebindKey` (or the deps that flow into it) so the handler closure sees the current value. Simplest: since `onSwipe` is defined inline in the options object passed to `useOrbGestures`, ensure the surrounding `useMemo`/deps (if any) include `editing`; if it's a plain object literal recreated each render, the ref-based `cbRef` inside `use-orb-gestures.ts` already picks up the latest callback — no rebind needed.

That's the entire fix. Taps, long-press, and other interactions remain untouched. When the user presses Done or Jump-to, `editing` flips back to false and swipes resume immediately.

### Files touched

- `src/routes/_authenticated/app.tsx` — one guard line inside the `onSwipe` callback.

No changes to gestures hook, styles, or any other component.