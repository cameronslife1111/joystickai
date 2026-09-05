# Long press a favorites slot to step to the next document

## What changes on the Favorites screen

- Long press any slot (about half a second) and that slot instantly moves to the next document in the alphabetical list — no picker, no leaving the screen. Every other slot holding the same document changes with it, the same as "Replace all matching slots" does today.
- Keep holding and pressing again to keep stepping forward until you land on the document you want. After the last document it wraps to the first.
- Long pressing an empty slot fills it with the first document alphabetically.
- A single press still opens the slot picker exactly as it does now.
- Holding a slot on iPhone no longer highlights the title in blue or raises the copy/paste callout.

## The note at the top

Replace the current line "Swipe right on the orb to cycle through these." with, at the same small size:

"Long press a slot below to jump to the next document, or tap it to choose one. 12 / 50 filled."

(The filled count stays as it is today.)

## Technical notes

In `src/routes/_authenticated/app.tsx`, inside the Favorites overlay (around lines 3257-3309):

- Update the helper text line.
- Give the slot `<button>` long-press handling in the same style as `ClusterOrb` in `src/components/OrbCluster.tsx`: a `pointerdown` timer at 500ms, cancel on move beyond ~12px, on `pointerup`/leave/cancel clear it, and suppress the following `onClick` when the hold fired. `onContextMenu` is prevented.
- Add Tailwind classes `select-none touch-none [-webkit-touch-callout:none]` to the slot button so iOS treats it as a control, not text.
- Long press handler: build the alphabetical list with the existing `sortDocsByTitle(docs ?? [])`, find the current doc's index (empty slot → index -1), take `(index + 1) % list.length`, then write a new favorites array replacing every entry equal to the old doc id (or just this slot when it was empty) and call `saveFavorites(next)`. Respect the existing `lockFavorites` guard with the standard "List is locked" toast. No navigation, no speech, `favoritesOpen` stays true.
- A short emoji toast confirms the new title, consistent with the rest of the app.

## Verification

- Long press slot 1 repeatedly: each hold advances one document alphabetically, other slots with the same document follow, the screen stays open.
- Tap slot 1: the picker still opens.
- On iPhone, holding a slot shows no blue selection or copy menu.
