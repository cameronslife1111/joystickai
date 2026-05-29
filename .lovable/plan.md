## What I’ll change

1. Keep the current gesture mapping as-is:
   - Single tap opens edit mode
   - Double tap opens new-idea mode
   - Triple tap, long press, and swipes stay unchanged

2. Fix the iPhone keyboard handoff so it stays open for both flows:
   - Prime focus during the live tap gesture
   - Prevent Orby’s button from reclaiming focus right after the tap
   - Transfer focus directly into the real textarea/composer as soon as that UI mounts

3. Preserve the existing caret behavior:
   - Single tap: caret lands right after the current sentence, with the inserted trailing space
   - Double tap: caret lands in “Type your new idea…” ready for typing

## Root cause

The keyboard is already trying to open, which means the primer focus is partially working. The likely failure is the focus sequence immediately after that:

- the hidden primer input gets focus during the tap
- Orby itself is still a real `<button>` and iPhone likely returns focus to it on release
- once focus leaves the text-input path, the keyboard dismisses
- the later textarea `focus()` is too late to reopen it reliably on iPhone

That explains why the search popup works: it focuses a real text input directly in the successful UI path, instead of going through Orby’s button.

## Implementation

### 1. Update `src/components/Orb.tsx`
- Make Orby non-focus-stealing on tap by preventing it from becoming the lasting focused element during pointer interaction.
- Keep it fully clickable/tappable and keep all existing gesture behavior intact.
- Preserve accessibility semantics as much as possible while avoiding the iPhone focus bounce.

### 2. Update `src/routes/_authenticated/app.tsx`
- Keep the hidden keyboard primer, but make the handoff more explicit and stable.
- On tap candidate, focus the primer synchronously inside the gesture.
- When opening edit mode or new-idea mode, immediately move focus from the primer to the mounted textarea.
- If needed, add a tiny “pending focus target” ref so the code knows whether the next successful handoff should go to edit or compose.
- Keep the single-tap caret placement after the current sentence exactly as requested.
- Keep double tap focused in the new-idea composer.

### 3. Validate the working paths
- Single tap on Orby: edit view opens, keyboard stays open, caret flashes after the current sentence
- Double tap on Orby: new-idea view opens, keyboard stays open, caret flashes in the composer
- Search popup behavior remains unchanged
- No regressions to swipe, triple tap, long press, or desktop click behavior

## Technical details

Files to update:
- `src/components/Orb.tsx`
- `src/routes/_authenticated/app.tsx`

No backend or database changes.

Expected fix strategy in plain terms:
```text
Tap on Orby
-> focus hidden primer immediately
-> do not let Orby keep focus
-> mount target textarea
-> move focus straight into textarea
-> keyboard remains open
```

## Success criteria

- On iPhone, the keyboard no longer flashes and disappears
- Single tap is immediately writable at the current sentence
- Double tap is immediately writable in “Type your new idea…”
- Existing orb gestures continue to work