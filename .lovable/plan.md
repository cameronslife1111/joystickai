# Long press = second action, no icon switching

## Goal

Drop the mode-toggle behavior on the pink, gray, and orange orbs. Each orb keeps one fixed icon; a tap runs its primary action and a long press directly runs its secondary action. Add a long press to the yellow menu orb that opens the New idea composer.

## New behavior

| Orb | Icon (fixed) | Tap | Long press |
| --- | --- | --- | --- |
| Yellow | Menu | Open menu | Open New idea composer (same as menu slot 13) |
| Orange | Pin | Open pinned document | Open Search docs overlay (cleared field) |
| Pink | Up/down arrows | Move sentence sheet | Jump to sheet |
| Gray | Picture | Media gallery | Open Chat to the thread list |

- No icon changes, no mode toasts, no lingering mode state.
- Gray badge always shows the unseen media count.
- Pinning a different document stays in the menu's Pinned doc item.
- Long press keeps the existing ~500 ms hold, drift tolerance, and tap suppression, and still avoids the iOS text-selection callout.

## Homepage legend

Labels return to a single primary name per orb: "Menu", "Pinned document", "Move sentence", "Media gallery".

## Technical notes

- `src/components/OrbCluster.tsx`: remove `orangeMode`, `moveMode`, `grayMode` props and the glyph branch used for the "J" icon. Replace with `onPinnedDoc` / `onPinnedDocLongPress`, `onMoveSentence` / `onJumpTo`, `onMediaGallery` / `onChat`, and add `onMenuLongPress`. Icons fixed to `Pin`, `ArrowUpDown`, `Image`, `Menu`. Labels: "Open pinned document (hold to search docs)", "Move sentence (hold to jump to)", "Media gallery (hold for chat)", "Open menu (hold for New idea)". Keep `grayBadge`.
- `src/routes/_authenticated/app.tsx`: delete the `pinkMode` / `grayMode` / `orangeMode` state and their toggle toasts; wire each long-press prop straight to the existing handler (`setSearchQuery(""); setSearchOpen(true)`, `setJumpOpen(true)`, chat-open with `setPendingChatThreadId(null); setChatStartInList(true)`, and `openNewIdea()`). Badge becomes `unseenCount`. Update the cluster comment.
- `src/routes/index.tsx`: update the `CLUSTER` labels.

## Verification

Long press each orb on the home screen: yellow opens New idea, orange opens search, pink opens Jump to, gray opens the chat list; taps still run the primary actions and no icons change.
