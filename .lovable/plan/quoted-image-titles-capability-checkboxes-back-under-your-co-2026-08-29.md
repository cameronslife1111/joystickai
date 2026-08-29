# Quoted image titles + capability checkboxes back under your control

## 1. Attach Image titles → quoted

Picked titles are inserted as `"Sunset sketch", "Logo v2", "Birthday idea"` — each title wrapped in straight double quotes, still comma-separated, still spliced at the cursor with the same spacing logic. Any quote characters inside a title itself are stripped so the quoting stays clean.

## 2. Regular chat: you decide the capabilities, and they stay on

Today Orby decides for itself whether a message needs multi-step planning, document editing, media, etc. — and it over-triggers plans. New behavior for normal chats:

- Orby never switches a capability on by itself. With nothing checked, every message gets a plain text answer — no plan card, no multi-step run.
- A plan only happens when you have checked at least one of Planning / Document editing / Image generation / Video generation / Scheduling. Web search only happens when Web search is checked (otherwise questions are answered from the conversation).
- The checkboxes are now sticky: whatever you check stays checked for that chat across sends, thread switches, closing and reopening the app, until you uncheck it (or hit Clear all). Each chat thread remembers its own set.
- The plan review card is unchanged: when a plan is created you still see the proposed steps with Approve / Add a note / Cancel.

The 🟣 Delegate flow (purple orb long press and slot 15) is untouched — it keeps deciding capabilities on its own and always produces a plan for review.

## Technical notes

**Titles**
- `insertTitlesAtCursor` in `src/components/ChatDialog.tsx`: map each title to `"${title.replace(/["“”]/g, "")}"` before `join(", ")`.

**Manual capability gating**
- `src/lib/chat-types.ts`: add `autoCapabilities: z.boolean().default(false)` to `chatTurnSchema`.
- `src/lib/chat-core.server.ts`: `classifyTurn` takes an `auto` flag.
  - `auto === true` (Delegate): current behavior, unchanged prompt and union logic.
  - `auto === false` (regular chat): the returned capabilities are exactly the user's ticked caps — no additions. Route is clamped after classification: `plan` downgrades to `chat` unless the user ticked an action group; `web` downgrades to `chat` unless `web_search` is ticked. The prompt is told which routes are available so it doesn't argue with the clamp. The `plan`-needs-an-action-capability fallback only applies in auto mode.
- `src/lib/chat.functions.ts` passes the flag through unchanged (it already forwards `data` to `runChatTurn`).

**Sticky checkboxes**
- `ChatDialog.tsx`: `pendingCaps` becomes the active thread's saved caps. New threads are created with `NO_CAPS` instead of `DEFAULT_CAPS`; on thread switch the checkbox state loads from `thread.capabilities`; toggling a box (and Clear all) persists via the existing `updateThread({ capabilities })` path so it survives reload.
- Remove the `setPendingCaps(NO_CAPS)` reset in `handleSend` and the "one-shot" comments.
- `handleSend` sends `autoCapabilities: false` for normal sends; `runDelegate` sends `autoCapabilities: true` with `DEFAULT_CAPS` (via an override on the existing `override` argument).
- The `route === "plan"` branch keeps `review_in_chat: true`; in manual mode `proposed_capabilities` is just the user's ticked caps.
- `normalizeCaps` defaults change from `DEFAULT_CAPS` to `NO_CAPS` so old threads don't come back with everything on.

## Verification

In a normal chat with nothing checked, "write me a poem about rain" answers as text with no plan card. Check Document editing, send "add a sentence to my notes doc" → review card appears; the box is still checked afterwards, and still checked after closing and reopening the chat. Purple orb long press still produces a Delegate plan card without touching a checkbox. Attach Image titles inserts `"Title A", "Title B"`.
