## Goal

Make the chat list the first thing you see when tapping Chat (slot 11), make that list fill the whole chat panel, and simplify the per-chat icons.

## Changes

### 1. Full-size chat list (`src/components/ChatDialog.tsx`)
The threads drawer is currently a narrow 288px side panel with a dark scrim to its right. Change it to fill the entire chat dialog area (same size as the chat itself), so titles get the full width and more breathing room.

- Panel spans the full dialog instead of `w-72 max-w-[80%]`; drop the dimmed side-scrim column.
- Header keeps "Chats" + "New", and gains a close (X / back) control since there's no longer a scrim to tap for dismissal.
- Slightly larger row padding and title text now that there's room.

### 2. Remove the eraser icon per row
Delete the "Clear messages" (eraser) button from each chat row. Keep the pencil (rename) and the trash (delete chat) icons, with a bit more spacing between them. The main trash-can clear-chat button in the chat header stays as-is.

### 3. Slot 11 opens the chat list, not the last chat
Add a `startInThreadList` prop to `ChatDialog`. When true, the dialog opens with the chat list showing; picking a chat closes the list and drops into that conversation.

In `src/routes/_authenticated/app.tsx`, the slot 11 Chat button sets that flag when opening the dialog. Other entry points that target a specific thread (voice-note toast, `openThreadId`) are unchanged and still go straight into their conversation.

## Technical notes

- The existing bootstrap effect still resolves an active thread underneath, so the conversation is ready the moment a chat is selected; only the initial `drawerOpen` value changes.
- `Eraser` import removed from `ChatDialog.tsx` if unused elsewhere in the file.
