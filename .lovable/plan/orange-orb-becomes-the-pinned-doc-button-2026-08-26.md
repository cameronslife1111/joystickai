# Orange orb becomes the Pinned Doc button

Replace the orange orb's "repeat sentence aloud" behavior with the same pinned-document behavior as the 📌 Pinned doc menu item (slot 19).

## Behavior

- Icon: pin (Lucide `Pin`) instead of the speaker icon.
- Single press: opens the pinned document — same path as the menu item, including the "No document pinned" toast when nothing is pinned, and reading the landing sentence aloud like today.
- Long press (~500ms, matching the center pad timing): opens the existing "📌 Pin a document" picker overlay with the search field cleared, so a new document can be pinned. Picking one pins it and immediately opens it, exactly as it does now.
- Long press does not also fire the tap action; the giggle animation still plays on press.
- The existing menu item in slot 19 stays exactly as it is.
- Repeat-aloud is removed as an orb action; the orange orb no longer speaks the current sentence on demand.

## Homepage copy

On the landing page, the orange orb's label changes from "Repeat aloud" to "Pinned document" in both the cycling caption and the legend list, and the orange orb renders the pin icon so it matches the app.

## Technical notes

- `src/components/OrbCluster.tsx`: add optional long-press support to `ClusterOrb` (pointerdown timer + cancel on move/up/leave, suppress the click when the long press fired), swap `Volume2` → `Pin` for the orange orb, rename the `onRepeat` prop to `onPinnedDoc` plus a new `onPinnedDocLongPress`, and update the label/aria text.
- `src/routes/_authenticated/app.tsx`: wire the orange orb to `openPinnedDocument()` and to `setPinPickerQuery("")` + `setPinPickerOpen(true)`, replacing the inline `speak(currentSentence)` handler.
- `src/components/LandingOrb.tsx`: map `orange` to the `Pin` icon.
- `src/routes/index.tsx`: update the orange entry in `CLUSTER` to "Pinned document".
- No backend, schema, or speech-engine changes.
