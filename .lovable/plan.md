# Linked-chat pill: add purple "needs approval" status

## Goal
Extend the linked-chat pill status dot so users can see when a plan is waiting for their approval:
- 🟣 **purple** when the thread has a plan with status `proposed` (needs approval)
- 🟡 **yellow** when a plan is actively working (`composing | approved | running | awaiting_media | retrying`) or the assistant hasn't replied yet
- 🟢 **green** when everything is finished

The pill's size, layout, and tap behavior stay unchanged.

## Changes
- `src/routes/_authenticated/app.tsx`
  - Update the inline `useQuery` that computes `linkedThreadStatus` to return a third state: `"approval" | "working" | "done"`.
  - Check order:
    1. Any plan status = `proposed` → return `"approval"`.
    2. Any plan status in the other active statuses OR the newest `chat_messages` row has `role = 'user'` → return `"working"`.
    3. Otherwise → return `"done"`.
  - In the linked-chat pill block (~line 2911), render `🟣` when status is `"approval"`, `🟡` when `"working"`, `🟢` when `"done"`.
  - Update the `aria-label` to reflect the three states.

## Notes / edge cases
- No database changes — `plans.thread_id`, `plans.status`, and `chat_messages.thread_id` already exist.
- The existing 5-second polling interval stays the same.
- If a thread has both a proposed plan and an actively running plan, purple wins so the user knows approval is needed.
