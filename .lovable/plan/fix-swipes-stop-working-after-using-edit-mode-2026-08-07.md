# Fix: swipes stop working after using edit mode

## What's happening

Hiding Orby while the editor is open (last update) removes the orb from the page entirely. When you press Done and come back, Orby is re-created as a brand-new element — but the gesture listeners (swipe up/down/left/right and tap) are still attached to the old, discarded one. Result: no swipes in normal mode until the page is reloaded. Same on desktop, since it's pointer-event based, not touch-specific.

## The fix

Make the gesture layer re-attach whenever Orby is mounted or unmounted:

- `src/hooks/use-orb-gestures.ts` — no logic change needed; it already supports a `rebindKey` for forcing re-binding.
- `src/routes/_authenticated/app.tsx` — include the editing state in the `rebindKey` passed to `useOrbGestures` (currently only keyed on the document icon URL), so exiting the editor rebinds listeners to the fresh orb element.

As a safety net for any future remount we don't anticipate, also rebind on the orb element itself by tracking it in state rather than relying only on the key.

## Verification

- Enter edit mode via single press, press Done, then confirm all four swipes work (next / menu / prev / favorites) plus single press and long-press recording.
- Repeat with a document that has a custom image icon, since that path renders a different orb component.

## Out of scope

No changes to the editor layout, the bottom Done / Jump to top buttons, or the recording tap guard.
