
## Problem

In `src/components/ChatDialog.tsx` the "Thinking…" indicator and send-disabled state use a single global `busy` boolean. When you send a message in Chat A and switch to Chat B while it's still running, Chat B shows "Thinking…" even though nothing was submitted there. The same global also blocks sending from Chat B until Chat A finishes.

The underlying send code already correctly writes to the right thread (it captures `threadId` locally, inserts messages by that id, and invalidates that thread's query). Only the UI busy state is global. Plan messages already render only in their own thread because they're stored per-thread in `chat_messages`.

## Fix

Convert the single `busy` boolean into a per-thread set of in-flight thread IDs, and gate all UI on the *active* thread's entry.

### Changes in `src/components/ChatDialog.tsx`

1. Replace `const [busy, setBusy] = useState(false)` with `const [busyThreadIds, setBusyThreadIds] = useState<Set<string>>(new Set())`, plus helpers `markBusy(id)` / `markIdle(id)` that immutably add/remove.
2. Derive `const isActiveBusy = activeThreadId ? busyThreadIds.has(activeThreadId) : false`.
3. In `handleSend`:
   - Guard with `busyThreadIds.has(threadId)` (not global) so each thread has its own in-flight lock; other threads stay free.
   - Call `markBusy(threadId)` at start and `markIdle(threadId)` in `finally`.
   - After the reply arrives, only auto-speak / auto-scroll-focus if the user is still on that same thread (`threadId === activeThreadId`), so a reply to Chat A never speaks while Chat B is open.
4. Replace remaining `busy` references:
   - Empty-state check (`messages.length === 0 && !busy`) → `!isActiveBusy`.
   - "Thinking…" indicator → render when `isActiveBusy`.
   - Send button `disabled` and Enter-key guard → `isActiveBusy || !input.trim()`.
   - Auto-scroll effect dep list → use `isActiveBusy` instead of `busy` so scrolling is tied to the active thread.
5. Keep the existing local `threadId` capture in `handleSend`; all DB writes and query updates already use it, so cross-thread bleed of *messages* is already correct — this change only fixes the *UI* bleed.

### Not changing

- Server function `sendChatMessage` — no change; it's already stateless per call.
- Plan running/monitoring — `PlanProgressCard` is rendered from the plan message in its own thread's message list, so plans continue in the background and only show in their own thread. No change needed.
- Thread bootstrap logic, storage, or DB schema.

### Verification

- Send in Chat A, immediately switch to Chat B → Chat B shows empty state, no "Thinking…", composer is enabled.
- Switch back to Chat A → "Thinking…" still visible until reply arrives; reply appears in Chat A only.
- Send in Chat A, then send in Chat B while A is still running → both threads show their own "Thinking…" independently; both replies land in their own thread.
- Auto-speak: reply to a background thread does not speak; switching back does not retroactively speak.
