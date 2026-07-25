## Goal
Make Orby's chat capabilities explicit, per-message opt-ins: checkboxes that all start unchecked (plain text reply is the default), and reset to unchecked after each message is sent.

## Changes — `src/components/ChatDialog.tsx`

**1. Capabilities become local, one-shot state**
- Replace the thread-persisted `caps` (read from `activeThread.capabilities`) with local component state `pendingCaps`, defaulting to all-false.
- Remove `setCap` writing to the `chat_threads` row; the DB `capabilities` column is left alone (new threads keep whatever default they already get) but is no longer what drives a send.
- Switching threads or opening the dialog also resets `pendingCaps` to all-false, so a checkbox never carries over between chats.

**2. Checkbox UI in the settings popover**
- Swap each `Switch` for the shadcn `Checkbox` (same label + hint rows, same 7 capability entries).
- Header copy becomes something like "Use for this message" so it's clear the selection applies to the next send only.
- "Read replies aloud" stays a persistent `Switch` (localStorage) — it's a preference, not a per-message action.
- A small "Clear all" / count line stays, now reflecting `pendingCaps`.

**3. Send behaviour**
- `handleSend` passes `pendingCaps` to `sendChatMessage` exactly where `caps` is passed today. With nothing checked, the server router already falls back to a plain text response (`classifyRoute` returns "chat" when nothing actionable and web search is off).
- Plan route: `ACTION_TOOL_GROUPS` filter continues to use the checked boxes, so a plan only gets the tools the user checked.
- After a send is dispatched (success or failure), reset `pendingCaps` back to all-false.

**4. Image attachments**
- Images today are only sent when `image_analysis` is on. To avoid a silent "my images were ignored", attaching images from the gallery auto-checks the **Image analysis** box, and the attachment chips still render whenever images are picked.
- "Attach image" button in the popover stays visible at all times instead of being hidden behind the capability being on.

**5. Composer affordance**
- Show a compact row of the currently checked capability names above the input (e.g. "Planning · Image generation") so the user can see, without opening settings, what the next message will do — and it visibly disappears after sending.

## Notes
- No server changes: `src/lib/chat.functions.ts` already accepts a full capabilities object and defaults everything off-path to chat when nothing is enabled.
- Existing threads' stored capability values simply stop being used for routing.
