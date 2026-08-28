# Orange orb long-press toggle + fix iPhone text selection on orbs

## Goal

Give the orange orb the same long-press mode switch the pink and gray orbs have: default is Pinned document (pin icon), a long press swaps it to Search docs (search icon), and a tap then opens the same Search docs overlay as the menu item. Another long press swaps back. Pinning a different document now happens only through the menu's Pinned doc item.

Also stop iOS from showing the blue text-selection / copy-cut callout when long-pressing any orb.

## Behavior

- Orange orb, `pin` mode: pin icon, tap opens the pinned document (unchanged, including the "No document pinned" toast).
- Long press: toast confirms the switch, icon becomes a magnifier, label updates.
- Orange orb, `search` mode: tap opens the Search docs overlay with the search field cleared — identical to the menu's 🔍 Search docs item.
- Long press again returns to pin mode.
- The pin picker overlay is no longer reachable from the orb; the menu's Pinned doc item is unchanged.
- Long-pressing pink, gray, or orange on iPhone no longer highlights the button or raises the copy/paste callout.

## Homepage copy

The orange orb legend entry becomes "Pinned document / Search".

## Technical notes

- `src/components/OrbCluster.tsx`: replace `onPinnedDoc` / `onPinnedDocLongPress` with `orangeMode: "pin" | "search"`, `onOrangeTap`, `onOrangeLongPress`; icon `Pin` vs `Search` (lucide-react); labels "Open pinned document (hold for Search)" / "Search docs (hold for Pinned document)".
- `src/routes/_authenticated/app.tsx`: add `orangeMode` state; tap calls `openPinnedDocument()` or `setSearchQuery(""); setSearchOpen(true)`; long press toggles with a toast (id `orange-mode`), matching the gray-orb pattern.
- `src/styles.css`: in the `glow-orb` utility add `-webkit-touch-callout: none`, `-webkit-user-select: none`, `user-select: none`, and `-webkit-tap-highlight-color: transparent` so iOS treats the orbs as controls, not text.
- `src/routes/index.tsx`: update the orange `CLUSTER` label.

## Verification

- Long-press orange: toast "🔍 Search docs", icon becomes a magnifier; tap opens the search overlay.
- Long-press again: toast "📌 Pinned document"; tap opens the pinned doc.
- On iPhone, long-pressing pink / gray / orange shows no selection highlight or copy menu.
