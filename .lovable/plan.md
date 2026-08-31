# Remove the "Prepare next sentences" option from the Sound popup

The prefetch depth is already working well at "2 ahead". This makes that the fixed behaviour whenever sound is on, and takes the control out of the Sound popup entirely.

## What changes

- The Sound popup (Slot 4) shows only: the on/off switch and the voice list. The "Prepare next sentences" card is gone.
- Whenever sound is on, the app always warms 2 sentences ahead (plus the neighbour, green-orb and orange-orb landing sentences) — exactly what happens today with "2 ahead" selected.
- When sound is off, nothing is warmed, as today.
- No change to how warming, caching, or playback work.

## Technical notes

- `src/components/SoundSettingsDialog.tsx`: delete the prefetch card and its `prefetch` / `onPrefetchChange` props.
- `src/routes/_authenticated/app.tsx`: stop passing those props; replace the `ttsPrefetch` preference read with a constant `2` in the prewarm effect and drop the now-unused setter/mutation and effect dependency.
- Leave the `user_preferences.tts_prefetch` column in place (unused, harmless) — no migration.

## Out of scope

No voice, orb, or warming-behaviour changes.
