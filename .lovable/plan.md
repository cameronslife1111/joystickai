# Send chat text to the New idea page

## What you'll get
A small light bulb button sits to the right of the chat's text input, next to the mic and send buttons. When there's text in the box, tap the bulb and the chat closes, the New idea page opens, and your text is already typed in — ready for the existing "Send to which list?" flow. Nothing is sent anywhere until you choose a destination.

## Behavior
- Bulb only works when the input box has text (grayed out when empty).
- Your typed text moves over exactly as-is — it is not sent to the AI, and the chat keeps its draft so nothing is lost if you come back.
- Works in any open chat, including linked sentence chats.
- Does not touch: sending messages, planning, voice typing, capabilities, or the idea page's own buttons — the send-to-list/chat/favorites flow stays exactly as it is.

## Technical details
- `src/components/ChatDialog.tsx`: add an optional `onSendToIdeas?: (text: string) => void` prop; render a `Lightbulb` icon button in the composer row, disabled when `input.trim()` is empty; on tap call `onSendToIdeas(input)` (untrimmed, so spacing is preserved).
- `src/routes/_authenticated/app.tsx`: pass a handler to the existing `<ChatDialog>` that (1) closes the chat via its open-state setter, (2) calls `cancelSpeech()`, (3) `setComposeText(text)`, (4) `setComposing(true)` — reusing the same path `openNewIdea` uses, just with initial text instead of a blank box.
- The composer already focuses its textarea on open, so the cursor lands in the text ready to edit or send.
- No database, edge function, or capability changes.

## Verification
- Build passes clean.
- Type text in a chat → tap bulb → New idea opens with the text → pick a destination → it lands correctly; cancel instead → chat draft is still there.
- Empty input → bulb disabled.
