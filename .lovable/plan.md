## Goal
Update the chat message bubbles so they are smaller, user messages are blue, and assistant messages get a gray bubble — working in both light and dark modes.

## Current state
- User messages: `bg-primary` (purple in dark mode), `text-[25px]`
- Assistant messages: no bubble, `text-[25px]`

## Changes

### 1. Add semantic chat bubble tokens to `src/styles.css`
Register new tokens under `@theme inline` and define values in `:root` and `.light`:
- `--chat-user`: a medium-light blue
- `--chat-user-foreground`: high-contrast text
- `--chat-assistant`: a neutral gray
- `--chat-assistant-foreground`: high-contrast text

### 2. Update message rendering in `src/components/ChatDialog.tsx`
Around lines 816–828, change:
- Text size from `text-[25px]` to `text-base` (16px)
- User bubble class to `bg-chat-user text-chat-user-foreground`
- Assistant bubble to a rounded gray bubble using `bg-chat-assistant text-chat-assistant-foreground`
- Keep max-widths, padding, and rounded corners consistent

### 3. Verify contrast
Ensure the chosen blue and gray values are readable against both dark and light backgrounds.

## Out of scope
No changes to chat functionality, thread logic, attachments, or the composer — only bubble appearance.