
# Queen Bee: async agents that report back

Right now a chat plan runs in the background, but when it finishes there's no assistant message in the thread — the result only lives on the plan card. And a plan can't pause to ask you something; it either finishes or fails. This upgrade makes each plan feel like an employee that goes off, does the work, checks in when it needs approval, and drops a summary message back in the thread when it's done. You can leave the chat, jump between threads, and come back to find each "bee" reporting in.

## What changes for you

1. **Agents report back in chat.** When a plan finishes (or fails, or is cancelled), Orby posts a real assistant message in the thread with what it did and asks "what next?". Works whether you're on the chat or not — you'll see the unread when you return.
2. **Mid-run check-ins.** During a long plan, Orby can drop a `📍 progress` message in the thread without stopping ("Finished drafting Section 1 — moving on to research"). Fire-and-forget.
3. **Approval gates.** Orby can pause a plan and ask a question ("I found 3 possible source docs — which one?" / "Draft is ready — approve to publish?"). The plan sits in `awaiting_user` and waits. Your next reply in that thread resumes it with your answer as context. If you never reply, it just waits.
4. **Longer plans.** Raise the per-plan step ceiling and lean on `expand_plan` + check-ins so Orby can chew on multi-phase work without hitting the wall.
5. **Unread badges per thread.** Thread drawer shows a dot on threads where an agent has posted since you last opened it, so you know which bees came home.

## How each piece works

**New assistant-facing tools (added to `supabase/functions/_shared/tools.ts` + handlers in `plan-step/index.ts`):**
- `send_chat_message(text)` — inserts a `chat_messages` row (`role='assistant'`, `kind='text'`, `plan_id=<this plan>`, `thread_id=<plan.thread_id>`). Non-blocking. Used for milestone updates.
- `ask_user(question, context?)` — inserts the assistant message AND sets the plan to `status='awaiting_user'` with a new `awaiting_since` timestamp. The runner exits cleanly; no watchdog escalation while awaiting.
- Both are gated: only usable when `plan.thread_id` is set (chat-originated plans).

**New plan status: `awaiting_user`**
- Migration: add `awaiting_user` to the `plans_status_check` CHECK constraint; add optional `awaiting_since timestamptz` column; add `awaiting_user` to the "runnable" indexes so it's skipped by the tick loop but visible in queries.
- Watchdog / plan-tick ignores plans in `awaiting_user` (no stall detection while blocked on human).
- `PlanProgressCard` gets an "Awaiting your reply" pill.

**Resuming on user reply (`src/lib/chat.functions.ts` `sendChatMessage`):**
- Before classifying intent, check the thread for the newest plan in `awaiting_user` status.
- If found: don't start a new plan. Append a system-visible note ("User reply to your question: <text>") to the plan's `user_request` (or a new `conversation_log jsonb` column — see technical notes) and flip status back to `running` with `current_step` pointing at the next unfinished step. plan-tick picks it up.
- The user message still gets saved to `chat_messages` as normal.

**End-of-plan report (`plan-step/index.ts` terminal branches):**
- On `completed`, `failed`, `cancelled`: if `plan.thread_id` is set AND no `send_chat_message` was made in the final step, auto-insert one assistant chat message with `result_summary` (or `error_message` + a friendly "want me to retry / try a different angle?"). Always tag `plan_id` and `kind='text'` so it renders as a normal bubble that also links back to the plan card.

**Prompt updates (`plan-compose/index.ts`):**
- New section "CHECK-IN CONTRACT" instructing Orby to: (a) call `send_chat_message` at natural milestones for plans with >5 steps, (b) call `ask_user` before any irreversible/ambiguous action (publishing, deleting, choosing among ambiguous matches, long-range strategy forks), (c) always end with a wrap-up summary via `send_chat_message` before the last step. Only inject when `thread_id` is present.
- Raise soft cap on step count in the composer prompt (from current limit to ~24 steps) and reinforce that `expand_plan` is preferred over cramming.

**ChatDialog UI (`src/components/ChatDialog.tsx`):**
- Thread list: query `chat_messages` for max(created_at) where `role='assistant'` per thread, compare against a per-thread `last_seen_at` stored in `localStorage` keyed by thread id; render a small dot on threads with newer agent messages. Clear on open.
- When rendering messages, if the latest assistant message belongs to a plan in `awaiting_user`, show a subtle "Reply to continue →" hint above the composer.
- No new screens; existing bubbles + plan card are enough.

**Realtime (optional but small):** subscribe the open thread to `chat_messages` inserts filtered by `thread_id` so agent check-ins appear live without needing to close/reopen. Already have supabase client — one `channel().on('postgres_changes', ...)` in ChatDialog.

## Safety / edge cases

- **Loops:** cap `ask_user` calls per plan at 5 (stored in a new `awaiting_count int` on plans). If exceeded, the plan force-completes with a warning message.
- **Cancelled while awaiting:** the existing Stop button on `PlanProgressCard` already sets `status='cancelled'` — reuse it; the terminal-report path posts the cancellation message.
- **Deleted thread:** `plans.thread_id` is already `ON DELETE SET NULL`, so orphaned plans quietly skip the chat-report step.
- **Race on resume:** wrap the "flip `awaiting_user` → `running`" update in a WHERE clause on current status to avoid double-resume if the user sends two messages fast.

## Technical notes

Files touched:
- `supabase/migrations/<new>.sql` — add `awaiting_user` to status CHECK, add `awaiting_since timestamptz`, `awaiting_count int not null default 0` on `plans`; update runnable indexes.
- `supabase/functions/_shared/tools.ts` — add `send_chat_message` and `ask_user` tool defs, gated by a new tool group `chat_reporting` that's enabled only when the plan has a `thread_id`.
- `supabase/functions/plan-step/index.ts` — handlers for the two new tools; terminal-branch auto-report; skip watchdog when `awaiting_user`.
- `supabase/functions/plan-compose/index.ts` — inject CHECK-IN CONTRACT section when `thread_id` present; raise step cap.
- `src/lib/chat.functions.ts` — detect `awaiting_user` plan on incoming user message and resume instead of composing a new plan; append reply to a lightweight conversation log (either extend `user_request` with `\n\n[USER REPLY @timestamp]: ...` or add a `conversation_log jsonb` column — leaning toward reusing `user_request` to avoid extra schema).
- `src/components/ChatDialog.tsx` — unread dots via `localStorage` last-seen map, "Reply to continue" hint, optional realtime subscription for the open thread.
- `src/components/PlanProgressCard.tsx` — "Awaiting your reply" pill for the new status.

No changes to media, gestures, or existing menu slots. No new secrets or connectors.
