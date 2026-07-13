## Goal

Three fixes to Orby's chat mode:
1. **Smarter intent routing** — only start a plan when the user clearly asks Orby to *do* something (edit a doc, generate an image/video, etc.), not just because a capability is toggled on.
2. **Always send attached documents** for a text answer, even with every capability toggled off.
3. **Stop button** on the in-chat plan card that fully halts the plan on the backend with no lingering/errored background work.

## 1. Tighter intent classification (`src/lib/chat.functions.ts`)

Rework `classifyRoute` so it defaults to `chat` and only escalates to `plan` on a clear action request:
- Rewrite the router system prompt to demand an **explicit action instruction** to choose `plan` — an imperative verb aimed at the workspace (e.g. "edit/rewrite/add to this document", "generate/make/create this image", "make these videos", "organize/rename my docs"). Questions, discussion, "what do you think", "help me write…", summarizing/answering about attached text, and anything ambiguous → `chat`.
- Add an explicit rule: **a capability being enabled is permission, not intent.** Never pick `plan`/`web` just because the toggle is on.
- Add a rule: when the user is asking *about* or discussing an attached document (not commanding a change to it), choose `chat` so it gets a normal text answer.
- Keep the existing guards that downgrade `web`→`chat` and `plan`→`chat` when the matching capability is off, and keep the JSON parse fallback to `chat`.

This keeps all the plumbing the same; only the decision prompt/logic gets stricter.

## 2. Guarantee attached documents are always sent (`src/lib/chat.functions.ts`)

`buildContext` already pulls the full (paginated) document regardless of capabilities, and the chat route appends it to the last user message. Harden this so an attached doc never gets lost to routing:
- In the handler, when `contextDocumentIds` is non-empty **and** the classified route is `plan`, re-run classification's guard: if the user did not clearly ask to *modify* documents/media, fall through to the normal `chat` route so the attached docs are sent for a text response. In practice this is handled by the stricter prompt in step 1, but add a short-circuit so that with documents attached the default is always a text answer unless the user explicitly issued an action.
- No change needed to the "everything off" path — it already returns `chat` early and sends the docs; verify it after the edit.

## 3. Stop button for in-chat plans

### Frontend (`src/components/ChatDialog.tsx`)
- Add a **Stop** button to `PlanProgressCard`, shown only while the plan is active (status not in `completed/failed/cancelled/proposed` — i.e. `composing`, `approved`, `running`, `awaiting_media`, `retrying`).
- On click: `update plans set status = 'cancelled' where id = planId`, then optimistically set the cached plan status to `cancelled` and show a "Plan stopped" toast. The card already renders `cancelled` as "Stopped".

### Backend guard (`supabase/functions/plan-compose/index.ts`)
- The runner (`plan-step`) already refuses to resurrect a cancelled plan (`.neq("status","cancelled")` on its writes), and both the client advancer and the `plan-tick` cron ignore cancelled plans — so `running`/`awaiting_media` stops are already clean.
- The gap: if the user stops **during composing**, `plan-compose`'s final write (line 598-607) sets `approved`/`proposed` and would revive the plan. Add `.neq("status", "cancelled")` to that update so a cancel during planning sticks and nothing starts running.

## Verification
- Confirm no type errors in the two edited TS files.
- Manually reason through the routes: (a) "what does this doc say?" with a doc attached + all caps on → `chat` with full doc sent; (b) "rewrite paragraph 2 in this doc" → `plan`; (c) all caps off + doc attached → `chat` with full doc sent; (d) Stop during composing and during running both end at `cancelled` with no further writes.

## Technical notes
- No DB schema changes. Cancellation reuses the existing `plans.status = 'cancelled'` mechanism already used by `AIPlansScreen`.
- Model, keys, and title generation are unchanged.
