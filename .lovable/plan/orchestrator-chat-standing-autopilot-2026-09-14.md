# Orchestrator chat — standing autopilot

One special chat, pinned to the top of the chat list and visually set apart (green glow), that you talk to like any other chat. The difference: it works through the other chats instead of doing everything itself, and it keeps thinking between your visits.

## How it feels to use

1. You open the Orchestrator chat and describe the goal ("set up a company for X").
2. It asks whatever it needs to know, then proposes a master plan in Go To Format.
3. You approve once. From then on every step runs without asking again — creating chats, renaming them, attaching documents and images, and posting instructions into those chats.
4. When the Orchestrator writes into another chat, the message appears on the right like yours, but green, so it's obvious who spoke. You can chime in yourself in that chat at any time.
5. You pick a set of focus documents for the Orchestrator to watch. Between runs it keeps reading them and drafting new plans.
6. Next time you open it, you may find several ready-to-approve plans waiting. You approve the ones you want; they queue up and run one after another so nothing overloads.

## What gets built

**The pinned Orchestrator chat**
- One per account, created automatically, always first in the chat list, green accent and glow, cannot be deleted (can be cleared).
- Has every capability turned on, can be linked to a sentence like any other chat.

**Talking to other chats**
- New abilities in plans: create a chat, rename a chat, attach documents/media to a chat, send a message into a chat, and ask that chat to plan and run its own work.
- Messages the Orchestrator sends into a chat are stored as a distinct kind and render as green bubbles on the user side, with a small "Orchestrator" tag.
- Child chats keep their own history, so you can open one later and read the whole exchange.

**Approval gate**
- Nothing runs until you approve it. Approving a master plan covers everything inside it, including the work it hands to child chats.
- Approving does not grant blanket future permission: each newly drafted plan still needs its own approval.

**Focus documents**
- A picker inside the Orchestrator chat to choose which documents it watches (and remove them).
- The list is stored per user, so it survives reloads and is visible to the background loop.

**Proposal inbox**
- A section at the top of the Orchestrator chat showing pending drafted plans, each with its trophy line and Go To steps, plus Approve / Dismiss.
- Capped at 10 pending proposals; the oldest untouched one drops off when a new one arrives.

**Background loop and pacing**
- A scheduled tick reviews the focus documents and finished child work, and drafts at most a couple of new proposals per pass, avoiding anything close to an existing pending proposal.
- Approved plans enter a queue and run one at a time per user, in approval order; a failure marks that plan failed and moves to the next instead of stalling the queue.
- A quiet switch to pause the loop entirely.

## Out of scope

- No change to how regular chats look or behave, other than the green bubbles and the new pinned row.
- The Orchestrator will not buy anything, message anyone outside the app, or delete documents.
- No changes to the Link popup, pills, or existing keyboard shortcuts.

## Technical notes

- New table `orchestrator_state` (user_id, thread_id, focus_document_ids, autopilot_enabled, last_tick_at) plus `plan_proposals` (user_id, thread_id, status, plan_summary, steps, proposed_capabilities, source, created_at), both with RLS scoped to `auth.uid()` and explicit GRANTs.
- `chat_threads` gains `is_orchestrator boolean default false`; `chat_messages` gains `author` (`user` | `assistant` | `orchestrator`) so the green bubble is a data property, not a client guess.
- New plan tools in `supabase/functions/_shared/tools.ts` and handlers in `plan-step`: `create_chat`, `rename_chat`, `attach_documents_to_chat`, `send_chat_message`, `delegate_plan_to_chat`. `delegate_plan_to_chat` enqueues a `chat_turns` row for the target thread with the orchestrator's request, so the child chat composes and runs its own plan through the existing pipeline.
- `plan-compose` gets an orchestrator system prompt layer: keeps Go To Format, adds the delegation vocabulary, and requires concrete thread/document ids from the WORKSPACE SNAPSHOT (CHAT CATALOG is already there) rather than invented ones.
- Autopilot runs as `src/routes/api/public/orchestrator-tick.ts` driven by a pg_cron job (every 5 minutes), calling a new `src/lib/orchestrator.server.ts` that builds context from focus documents plus recent child-chat outcomes and drafts proposals with `openai/gpt-5.6-sol`, matching the current chat core.
- A per-user run queue: the tick starts an approved plan only when that user has no plan in `running`/`approved`, so concurrency stays at one and existing `plan-tick` keeps advancing steps.
- UI work in `src/components/ChatDialog.tsx`: pinned orchestrator row, proposal inbox list, focus-document picker (reusing `DocumentPickerSheet`), green bubble styling from the `author` column.
