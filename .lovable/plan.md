Rearrange the chat composer so the accessory buttons sit in a vertical stack on the right, with the textarea stretching to the left edge, and make the send button blue.

## What to change

In `src/components/ChatDialog.tsx`, update the composer row (currently `flex items-end gap-2` with mic, clock, note, textarea, send).

1. Move the textarea to the left and let it fill the full width.
2. Place the three accessory buttons and the send button in a right-hand vertical stack, ordered top-to-bottom:
   - Schedule (clock)
   - Insert document text (sticky note)
   - Voice input (red circle)
   - Send
3. Change the send button color from the default purple/primary to the app's blue aurora token (`bg-aurora-1 text-foreground hover:bg-aurora-1/90`).
4. Keep all existing click handlers, disabled states, aria-labels, titles, and the red-circle/stop-square content unchanged.

## Verification

- Run `bunx tsgo --noEmit` to confirm no TypeScript errors.
- Check `/tmp/observability/build-errors.log` for a clean build.
- Visually confirm in the preview that the textarea reaches the left edge, the stacked buttons sit flush on the right, and the send button is blue.
