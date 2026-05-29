## Goal

Three crucial changes to the orb interaction in `src/routes/_authenticated/app.tsx` (plus a small addition to `src/hooks/use-orb-gestures.ts`):

1. **Swap tap gestures** — single tap opens the **edit view**; double tap opens the **new idea** composer.
2. **Single-tap edit must pop the keyboard automatically** on iPhone (and place a flashing caret), exactly like the Search Docs input in slot 11 does.
3. **Insert a space after the current sentence** and put the caret right after that space, so the user can immediately start typing.

## The core technical problem (first principles)

iOS Safari only shows the on-screen keyboard when `element.focus()` runs **synchronously inside the original user-gesture event** (tap/click). Two things currently break that chain for the orb editor:

- The edit textarea calls `el.focus()` inside `requestAnimationFrame(...)` — deferred, so iOS suppresses the keyboard.
- `useOrbGestures` fires `onTap` only **after** a ~280ms `setTimeout` (needed to tell a single tap apart from a double tap). By the time `onTap` runs, the user gesture is over, so even a synchronous `focus()` there won't open the keyboard.

The Search Docs input works because its `ref={(el) => el.focus()}` runs right inside the tap on the slot-11 button.

### Solution: keyboard "priming"

We focus a tiny persistent hidden input **synchronously on pointer-up** (inside the live gesture), which brings the keyboard up immediately. Then, when the single-tap edit view opens a moment later, we move focus from the hidden input to the real edit textarea. iOS keeps the keyboard visible when focus moves between fields, so the keyboard stays up and the caret lands in the textarea. On a double tap we simply blur the hidden input so the keyboard dismisses and the new-idea composer opens normally. Desktop is unaffected (focus just works).

## Changes

### 1. `src/hooks/use-orb-gestures.ts`
- Add an optional `onTapCandidate?: () => void` callback to `OrbGestureCallbacks`.
- In the `onPointerUp` handler, at the moment a press is classified as a tap (not a swipe, not a long-press) — i.e. right before/where `tapCount` is incremented — call `cbRef.current.onTapCandidate?.()` **synchronously** (before the existing `setTimeout`). This is the only place that still runs inside the user gesture, so it's where keyboard priming must happen.

### 2. `src/routes/_authenticated/app.tsx`

**a. Swap the gestures** (around lines 674–687):
- `onTap` → call the edit handler (renamed/reused from current `onDoubleTap`).
- `onDoubleTap` → call `openNewIdea`.
- Keep triple tap (delete), long press (plan composer), and swipes unchanged.

**b. Rename `onDoubleTap` → `enterEdit`** (lines 648–663), keep its body (cancel speech, set `editOriginIdxRef`, build `editText`).

**c. Add a hidden priming input + handler:**
- Add a `keyboardPrimerRef = useRef<HTMLInputElement | null>(null)`.
- Render a visually-hidden, off-screen `<input>` (opacity 0, fixed, 1px, `aria-hidden`, `tabIndex={-1}`) that stays mounted.
- Add `onTapCandidate` callback: synchronously call `keyboardPrimerRef.current?.focus()`. This runs inside the tap and opens the iOS keyboard immediately. (Guard: only meaningful on touch; harmless on desktop.)
- Wire `onTapCandidate` into `useOrbGestures`.
- In the **double-tap** path (`openNewIdea`), blur the primer first (`keyboardPrimerRef.current?.blur()`) so the keyboard dismisses before the composer opens.

**d. Insert a space + place caret, and transfer focus synchronously** (edit textarea ref callback, lines 1472–1535):
- When building `editText` in `enterEdit`, the caret target is the end of the current sentence. Insert a single space there so the stored text is `...current sentence. ` + `\n\n` + rest, and the caret sits **after** that space.
  - Simplest robust approach: keep `editText` as the joined sentences, but compute the caret index at end of the current sentence, then splice a `" "` into the string at that index and set the caret to `index + 1`.
- In the textarea ref callback, **remove the `requestAnimationFrame` wrapper around `el.focus()`** and call `el.focus()` synchronously (focus transfers from the primed hidden input → keyboard stays up). Keep the caret-positioning and the mirror-based centering logic, but run the centering in `requestAnimationFrame` only for scroll math (not for focus).
- Set `el.setSelectionRange(caret, caret)` to the post-space position so the caret flashes right after the inserted space.

## Technical notes / edge cases
- Empty document (no sentences): edit opens with empty text; still focus + keyboard. No space insertion needed.
- The trailing space is cosmetic for typing; existing sentence re-parsing on Done/Jump trims whitespace, so it won't create empty sentences.
- Desktop click also benefits: synchronous focus works without the primer, and the primer focus is a harmless no-op.
- No backend, schema, or data changes. Purely front-end interaction code.

## Files touched
- `src/hooks/use-orb-gestures.ts` — add `onTapCandidate` synchronous hook.
- `src/routes/_authenticated/app.tsx` — swap gestures, add hidden primer input, insert space + caret, synchronous focus.
