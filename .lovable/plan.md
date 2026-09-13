# Rename button inside an open chat

## What you'll see

Inside any open chat, next to the red trash can at the top, there will be a small pencil button. Tap it and the same "Rename thread" popup you already get from the chat list opens, pre-filled with that chat's current title. Save (or press Enter) renames the chat; Cancel or Escape closes it. No more going back to the chat list just to rename.

## How it works

- `src/components/ChatDialog.tsx` already has the full rename flow used by the chat list: the `renameThread` / `renameValue` state, the `submitRename()` save handler (defaults to "Untitled" if left blank, refreshes the list), and the rename dialog itself, which is rendered at the top level so it works from any view.
- Add one ghost icon button with the existing `Pencil` icon, placed directly before the trash button in the open-chat header (the row at line ~1390). Tapping it sets `renameThread` to the active thread and pre-fills `renameValue` with its title — exactly what the list view's rename button does at line ~2048.
- The button is disabled/hidden when no chat is open, matching the trash button's behavior.
- No database or backend changes; reuses the existing update path.

## Verification

- `bunx tsgo --noEmit` passes, build log clean.
- Manual check in preview: open a chat, tap the pencil, rename, confirm the new title shows in the header and in the chat list.
