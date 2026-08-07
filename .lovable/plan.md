# Edit-screen cleanup + orb tap guard

## What we're changing

### 1. Edit screen layout (app.tsx)
- Hide the Orby orb section while the full-document editor is open.
- Move the "Done" and "Jump To" buttons to the very bottom of the screen so the textarea can use the freed vertical space.
- Rename "Jump To" → "Jump to top" and make it save the edits, then jump the reader to sentence index `0`.
- Reduce the editor text size by one step (e.g. `text-2xl` → `text-xl`, `md:text-3xl` → `md:text-2xl`).

### 2. Orb single-tap guard during recording (app.tsx)
- While the red recording glow is active from a long-press of the orb, ignore the orb single tap that normally opens edit mode.
- The guard only applies during the active recording state; once recording stops and the glow disappears, single-tap edit mode works normally again.

## Files to change
- `src/routes/_authenticated/app.tsx` — editor layout, button placement, jump behavior, and tap guard.

## Out of scope
- No changes to the long-press recording toggle behavior itself.
- No changes to the jump-to dialog used in normal reading mode.
