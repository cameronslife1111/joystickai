# Green orb long-press = Link to doc

## Goal

Add a long-press action to the green orb that opens the same "Link this sentence to a document" popup as Slot 18.

## Changes

### 1. `src/components/OrbCluster.tsx`
- Add `onNextDocLongPress: () => void` to `OrbClusterProps`.
- Pass it as `onLongPress` on the green orb.
- Update the green orb label to "Next document (hold to link this sentence)".

### 2. `src/routes/_authenticated/app.tsx`
- Wire `onNextDocLongPress={() => setLinkPickerOpen(true)}` on the `<OrbCluster />` call.

### 3. `src/routes/index.tsx`
- Update the `CLUSTER` green-orb label to "Next document (hold to link this sentence)".

## Out of scope
- No change to the green orb single-tap behavior (still opens next document).
- No change to the LinkDocumentDialog itself or Slot 18 behavior.
