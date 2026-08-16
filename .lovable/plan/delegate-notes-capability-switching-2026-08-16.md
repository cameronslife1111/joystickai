# Delegate notes + capability switching

Two additions to the 🟣 Delegate card (slot 15).

## 1. A Note box under each checkbox

- Each of the five suggestions gets its own "Note (optional)" text area right below it.
- The note area appears only when that checkbox is checked, so the card stays compact.
- Placeholder tells the user what it's for: extra info, documents to reference, images in the media gallery, links, constraints.
- Whatever they type is passed to Orby as extra instructions attached to that specific task, so the plan it builds takes the note into account.
- Notes on unchecked items are ignored.

## 2. Capabilities turn on from the picks

- Each suggestion carries the capabilities it needs (web search, document editing, image generation, video generation, scheduling, image analysis, planning).
- On Approve, the union of the checked suggestions' capabilities is switched on in that chat — and the chat's capability checkboxes visibly show them on for that send, so the user can see what Orby was allowed to use.
- Planning is always on (it's a multi-step plan). Web search is also forced on when any note or the current line mentions the web, a URL, or looking something up.
- The plan may use those capabilities freely, but scope stays tight: only the approved tasks and their parent task; no other steps or documents.

## Edge cases

- Approve stays disabled until at least one box is checked; notes alone don't count.
- A note longer than a reasonable length is trimmed before sending.
- After Approve the card becomes read-only and shows each approved task with its note.

## Technical notes

- `src/lib/delegate-prompt.ts`: add `capabilities: string[]` to `DelegateSuggestion`, ask the suggestion model to include the capabilities each task needs, and extend `buildDelegatePlanPrompt` to accept `picked: { suggestion, note }[]` so each approved item prints its note as "EXTRA INFO FROM ME:".
- `src/lib/delegate.functions.ts`: widen the output schema with a capabilities array (validated against the known capability keys, unknown values dropped) and keep returning the same shape otherwise.
- `src/components/DelegateSuggestionsCard.tsx`: add `notes: string[]` to the `choose` state plus an `onNote(i, value)` prop; render a `Textarea` under each checked row; approved phase renders the notes read-only.
- `src/components/ChatDialog.tsx`: hold notes in the card state, and in `approveDelegate` compute the capability union from the picked suggestions (merged over `planning: true`), call `setPendingCaps` with it so the UI reflects it, and pass it as `caps` to `handleSend` instead of the blanket `DEFAULT_CAPS`.
- No schema, edge function, or plan-engine changes; approval still flows through the existing `handleSend` → plan-compose path.
