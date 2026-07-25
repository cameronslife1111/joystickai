## Goal

After a plan finishes in a chat thread, Orby should remember it — what was requested, what it did, which documents/media it created or changed — and use that as context for every later message in that thread. Plans should always come back to the chat with a real, written wrap-up, so a thread feels like an ongoing collaboration with an employee rather than a series of dead-end tasks.

## What's happening today (verified)

- `src/components/ChatDialog.tsx` builds the history it sends to the model with `.filter((m) => m.kind !== "plan")` — every plan card is stripped out, so the model literally never learns a plan happened.
- `src/lib/chat.functions.ts` only receives that filtered text history plus explicitly attached documents. It has no access to `plans` rows for the thread.
- `supabase/functions/plan-step/index.ts` closes a plan with a canned string: `"✅ All done. " + summarizeRun(steps)` — a numbered list of step descriptions, not a written reply.
- `supabase/functions/plan-compose/index.ts` composes each new plan from the single user request; it doesn't see the thread's earlier plans, so a follow-up like "now add a section to that doc" has no idea which doc.

## Plan

### 1. Plan memory for chat (`src/lib/chat.functions.ts`)

Add a `buildPlanMemory(supabase, threadId)` helper that loads the thread's recent finished plans (`status in (completed, failed, cancelled)`, newest ~6) and distills each into a compact block:

- the original request and `plan_summary` / `result_summary`
- outcome (completed / failed + reason)
- artifacts derived from each step's `result` JSON: document ids + titles created or edited, media asset ids/urls generated, schedules created

Inject this as a `[Workspace memory — plans already completed in this conversation]` section of the system prompt, with an instruction that these results are real and already exist, and that Orby should build on them instead of re-doing or re-asking.

### 2. Re-reading plan documents

Any document touched by a remembered plan becomes implicitly available. The helper resolves titles for those doc ids and lists them as `title (id)`. For the 1–2 most recently touched documents, pull current content through the existing paginated sentence fetch (same code path as attachments, char-capped) so Orby can answer about the doc without the user re-attaching it. Older ones are listed by title/id only, with a note that a follow-up plan can target them by id.

### 3. Route classification awareness

Pass a one-line plan-memory digest into `classifyRoute` so follow-ups such as "add two more paragraphs to that" resolve against the last plan's target document instead of being misread as generic chat.

### 4. Send the plan cards through as history (`src/components/ChatDialog.tsx`)

Stop dropping `kind === "plan"` rows. Map each to a short assistant line (`[Ran a plan: <request>]`) so conversation order stays coherent; the detailed facts still come from the server-side plan memory in step 1.

### 5. Real closing message from plans (`supabase/functions/plan-step/index.ts`)

Replace the canned completion string with a generated wrap-up: on `completed`, call the model with the user request, the step results, and the artifact list, and post a short conversational message to the thread ("Done — I added the three sections to *Roadmap* and generated two images; want me to…"). Falls back to the current summary text if the model call fails. Same treatment for the failure path so the chat always gets a human-readable reason plus a suggested next step.

### 6. Plans build on prior plans (`supabase/functions/plan-compose/index.ts`)

When the plan has a `thread_id`, load the same plan-memory digest plus the last few chat turns and add them to the composer prompt under the existing WHERE RULES, so a new plan can reuse concrete `document_id`s from earlier plans instead of inventing targets. Fresh-plan isolation is preserved: only ids/titles/outcomes are carried across, never the earlier plan's step instructions.

### 7. Clear chat resets memory

`Clear chat` and thread delete currently only remove `chat_messages`. Add a `plans` update setting `thread_id = null` for that thread in the same action, so a cleared thread genuinely starts blank and no orphaned plan memory leaks into the next conversation.

## Technical notes

- All plan-memory reads go through the request-scoped authenticated Supabase client (RLS as the user); the edge function keeps using `admin` as it already does.
- Memory blocks are hard-capped (plan count, per-plan chars, doc content chars) so long threads can't blow the context budget.
- No schema change is required — `plans.thread_id`, `steps`, `result_summary`, and `attached_document_ids` already carry everything needed.
