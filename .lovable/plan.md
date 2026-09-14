# Add wide back button to chat thread-list drawer

Add the same full-width horizontal back bar used at the bottom of the menu to the bottom of the chat thread-list popup, so the user can close the chat without reaching for the small X in the header.

## What to change

- File: `src/components/ChatDialog.tsx`
- Inside the `drawerOpen` thread-list overlay (the absolute full-height panel that shows the search + list of chats), add a wide back button below the scrollable thread list.
- Style: match the existing menu/menu-adjacent back bars — `w-full`, `rounded-2xl`, `border border-foreground/10`, `bg-card/60`, `py-3`, single `←` arrow, hover state.
- Behavior: closes the entire chat popup (`onOpenChange(false)`), identical to the existing bottom close button that appears when a conversation is open.
- Include `env(safe-area-inset-bottom)` padding so it sits above the iPhone home indicator.
- Keep the existing header X button and the existing bottom close button unchanged.

## Verification

- `bunx tsgo --noEmit` passes.
- Build log shows no errors.
- Manual check: open chat, land in thread list, see the wide ← bar at the bottom, tap it to close the popup.
