## Goal
Fix the broken "Clear chat" button in the slot 13 chat dialog, and move it out of the gear-icon popover into a standalone trash-can button placed at the top of the chat, just to the left of the gear icon.

## Why it's broken
In `src/components/ChatDialog.tsx`, `handleClear` uses the browser's native `confirm()` dialog. On mobile (and inside a closing Popover), `confirm()` is frequently blocked or dismissed instantly, so the delete never runs — nothing happens when pressed. We'll replace it with a proper in-app confirmation (shadcn `AlertDialog`) that works reliably on phone and desktop.

## Changes (all in `src/components/ChatDialog.tsx`)

1. **Add a trash-can button in the header**, to the left of the gear icon:
   - In the `DialogHeader` row, place a `🗑️` / `Trash2` icon button immediately before the existing gear `Popover` trigger.
   - Pressing it opens the confirmation dialog described below.

2. **Replace `confirm()` with an `AlertDialog`** (reliable on mobile):
   - Add state like `clearConfirmOpen`.
   - The trash button sets `clearConfirmOpen = true`.
   - The AlertDialog shows "Clear the entire chat? This cannot be undone." with Cancel / Clear actions.
   - The Clear action runs the existing delete logic (delete `chat_messages` for the user, reset the query cache, toast success/error).

3. **Remove the old "Clear chat" entry from the gear popover**, since it now lives in the header as the trash button.

4. Keep the existing delete logic (`supabase.from("chat_messages").delete().eq("user_id", userId)` + `qc.setQueryData(..., [])` + toast) — only the trigger/confirmation mechanism changes.

## Verification
- Open chat (slot 13) on phone-sized viewport: confirm a trash-can button appears left of the gear icon.
- Tap it → confirmation dialog appears → tap Clear → messages clear and a success toast shows.
- Confirm the old "Clear chat" item is gone from the gear menu and the gear menu still works for its other options.
