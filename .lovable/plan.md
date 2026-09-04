# Swap the long-press actions on the red and orange orbs

## New behavior

| Orb | Tap | Long press |
| --- | --- | --- |
| Red (trash) | Delete current sentence (unchanged) | Open Search docs, with the field cleared |
| Orange (pin) | Open the pinned document (unchanged) | Open the "Pin a document" picker so a new document can be chosen |

Safety on the red orb: holding it must never delete. The hold timer fires the search overlay and the tap action is suppressed, so a long press opens search only. A short tap still deletes exactly as today.

The lock still applies to the orange orb: while the list is locked, both orange tap and hold do nothing except show the "List is locked" notice. The red orb's delete and search are unaffected by the lock.

## Technical notes

- `src/components/OrbCluster.tsx`: add `onDeleteLongPress` to the props and wire it to the red `ClusterOrb` as `onLongPress`; label becomes "Delete sentence (hold to search docs)". Orange orb keeps `onPinnedDoc` / `onPinnedDocLongPress`; only its label text changes to "Open pinned document (hold to pin a document)". `ClusterOrb` already suppresses the click when a hold fires, so no delete can slip through.
- `src/routes/_authenticated/app.tsx`: pass `onDeleteLongPress={() => { setSearchQuery(""); setSearchOpen(true); }}`; change `onPinnedDocLongPress` to open the existing pin picker (`setPinPickerQuery(""); setPinPickerOpen(true)`) keeping the lock guard.
- `src/routes/index.tsx`: update the landing-page legend labels for the red and orange orbs.

## Verification

- Tap red: sentence deletes with the usual undo option.
- Hold red: search overlay opens, no sentence deleted.
- Hold orange: pin picker opens; choosing a document pins and opens it.
- With the list locked: orange does nothing but the lock notice; red still deletes on tap and searches on hold.
