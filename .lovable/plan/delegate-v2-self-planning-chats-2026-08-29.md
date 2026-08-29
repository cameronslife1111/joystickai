# Delegate v2 + self-planning chats

Two connected changes: (1) Delegate becomes a one-tap "plan this step" flow reachable from the purple orb, and (2) every chat can decide on its own that a request needs real work, propose the plan and the capabilities it wants, and wait for your approval or notes.

## 1. Purple orb long press = Delegate

- Tap purple: next sentence (unchanged).
- Hold purple (~500 ms): runs exactly the same Delegate action as menu slot 15. Slot 15 stays.
- Nothing to delegate (no document open / no sentences): the existing "Nothing to delegate yet" toast.
- Homepage legend for the purple orb: "Next sentence (hold to delegate)".

## 2. Delegate becomes automatic

The 5-suggestion checkbox card is removed. One tap now does all of this:

1. Captures the sentence you are standing on, plus a window of lines around it.
2. Opens a brand-new chat titled `Delegate: <document title>` with that document attached.
3. Orby decides whether that line is a substep of a larger task or a standalone task, and names the parent task.
4. Orby writes a plan for that task and only that task, and decides for itself which capabilities it needs — multi-step planning, document editing, web search, image generation, video generation, scheduling. You never toggle anything.
5. The plan appears in the chat as a review card instead of starting immediately:
   - the detected task ("This line is substep 3 of: Launch the newsletter"),
   - the capabilities it will use, phrased plainly ("I'll use web search to find X and put the output in this document"),
   - each step as "Orby will use X to do Y and put the output in Z",
   - buttons: **Approve**, **Add a note**, **Cancel**.
6. **Add a note** opens a small text box (with the red dictation button). Your note is added to the request and Orby rewrites the whole plan, then shows the card again. You can do this as many times as you want.
7. **Approve** starts it in the background: the usual progress card with per-step status and a Stop button.

## 3. Every chat plans on its own

Today a chat only takes action when you tick capability checkboxes first. New behavior:

- Orby judges each message itself. Pure text/questions still answer straight back into the chat — no card, no friction.
- When it decides work is needed, it does **not** run silently. It posts the same review card: what it detected, which capabilities it wants to switch on, the step-by-step breakdown, and Approve / Add a note / Cancel.
- The capability checkboxes stay for the times you want to force something on; anything you tick is always honored, and Orby may add capabilities you didn't tick when a step needs them. It never removes one you ticked.
- Notes steer everything: "don't use video", "put the output in a new document", "reply in the chat instead" all cause a full replan before anything runs.

## 4. Stopping, errors and steering — always back in the chat

- Every plan started from a chat stays bound to that chat.
- A plan that needs a decision mid-run already pauses and asks in the chat; your next message answers it (unchanged).
- A plan that fails or is stopped now shows, inside its chat card, the reason plus a "Tell Orby what to do" box. What you write becomes the next turn in that same thread, Orby replans (again auto-picking capabilities, again showing the review card) and continues from where it stopped.
- Default output destination is the chat unless a step explicitly targets a document, image, or video.

## Edge cases

- Approve is available as soon as steps exist; a plan Orby refuses to make shows its reason with Retry.
- Planning failure shows the error in the card with Retry; the chat keeps working.
- Two rapid Delegate taps create one thread and one plan (guarded by a nonce, as today).
- Hands-free voice calls keep text-only behavior — no auto-plans mid-call.

## Technical notes

**Data**

- Migration: add `plans.review_in_chat boolean not null default false` and `plans.proposed_capabilities jsonb not null default '{}'::jsonb`. Additive with defaults; grants unchanged.

**Auto-capability + review routing**

- `src/lib/chat-types.ts`: extend the turn result to `{ route, text?, capabilities?, rationale? }`.
- `src/lib/chat-core.server.ts`: `classifyRoute` becomes `classifyTurn`, returning `{ route, capabilities, rationale }` from one `gpt-5.6-sol` call — it names the capabilities the work needs, unioned with (never subtracted from) whatever the user ticked. `plan` route now also returns those capabilities. Existing web/chat/resume paths untouched.
- `src/components/ChatDialog.tsx` `handleSend`: on `route === "plan"`, insert the plan row with `review_in_chat: true`, `proposed_capabilities` set to the returned capabilities, and pass `allowed_tool_groups` derived from them to `plan-compose`.
- `supabase/functions/plan-compose/index.ts`: when `review_in_chat` is true, always finish at `proposed` (skip the thread/schedule auto-approve branch). Prompt gains a rule that `summary`/`explanation` must read as "Orby will use <capability> to <do Y> and put the output in <Z>" per step, and must state the detected task/parent task; `io.capability` contract stays.
- `src/hooks/use-composing-plans-watcher.ts`: skip auto-approve and the toasts for plans with `review_in_chat` — those are reviewed in their chat card.

**Review card**

- `src/components/DelegateSuggestionsCard.tsx` is replaced by `src/components/PlanReviewCard.tsx`: phases `analyzing | review | replanning | approved | error`. Renders task context, capability list, steps with their io breakdown, and Approve / Add a note (textarea + `DictateButton`) / Cancel.
- Approve: `plans.status = 'approved'`, `approved_at`, invoke `plan-step`; the card hands off to the existing `PlanProgressCard`.
- Add a note: append `\n\nNOTE FROM ME: <note>` to `plans.user_request`, set `status = 'composing'`, re-invoke `plan-compose`; card returns to `replanning`.
- Cancel: `status = 'cancelled'`.
- `PlanProgressCard` gains the failed/stopped steer box, which calls the parent's `handleSend` with the typed text in the same thread.

**Delegate**

- `src/lib/delegate-prompt.ts`: drop the 5-suggestion system prompt; keep `buildDocWindow`; add `buildDelegatePlanPrompt` variant that carries the doc window, the "substep or standalone task" instruction, the "decide and state your own capabilities" instruction, and the existing hard scope rule.
- `src/lib/delegate.functions.ts`: `suggestDelegateTasks` → `analyzeDelegateStep`, returning `{ title, sentences, index, taskContext, isSubstep, parentTask }` (still `gpt-5.6-sol`, auth-gated, sentences loaded server-side).
- `src/components/ChatDialog.tsx`: the delegate effect creates the thread, attaches the doc, calls `analyzeDelegateStep`, then immediately calls `handleSend` with the composed prompt and all capabilities allowed — the normal `route: "plan"` path then produces the review card. No checkbox step.
- `src/routes/_authenticated/app.tsx`: pass `onNextLongPress={handleDelegate}`; `src/components/OrbCluster.tsx`: add the prop and wire it to the purple orb's existing long-press machinery (same hold duration, drift tolerance, tap suppression); `src/routes/index.tsx`: update the purple label.

## Verification

Hold the purple orb on a document with sentences: a Delegate chat opens, the review card names the step and its capabilities, a note triggers a visible replan, Approve runs it in the background with Stop working. In a normal chat, "make me a doc summarizing X with an image" produces the review card with document editing + image generation pre-selected without touching a checkbox, while "what do you think of this?" still answers as plain text.
