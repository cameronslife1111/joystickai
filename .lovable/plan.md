## Goal
Move the "Linked chat" pill/button out of the top header and place it just above the Orby circle. Keep the "Linked document" pill at the top unchanged.

## Current state
- In `src/routes/_authenticated/app.tsx`, both the linked-document pill and the linked-chat pill are rendered inside the top `<header>` block (around lines 2264–2292).
- They are mutually exclusive: the chat pill only appears when the current sentence has a `linked_thread_id` but no `linked_document_id`.
- The Orby circle lives in the lower `<section className="relative flex shrink-0 items-center justify-center pb-4">` (around line 2525).

## Changes
1. **Remove the linked-chat pill from the header**
   - Delete the conditional `Linked chat` button block from the top header.
   - Leave the linked-document pill exactly where it is.

2. **Add the linked-chat pill above the orb**
   - Insert the same styled `Linked chat` button just above the orb-stage `<section>`.
   - Keep the existing behavior: clicking it calls `openLinkedChat()`.
   - Maintain the same visual style (rounded pill, primary border/background, icon + text).

## Files
- `src/routes/_authenticated/app.tsx`

## Notes
- No data model or route changes.
- The mutual exclusivity between linked document and linked chat stays the same.