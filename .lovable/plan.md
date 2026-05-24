# Fix Call Mode → Plan generation

## Problem

When you end a Call Mode session with "make a plan", the entire raw transcript (every user line + every Orby reply) is dropped into `plans.user_request` with only a one-line instruction telling `plan-compose` to "turn this conversation into a plan." The planner then treats the conversation itself as the request and:

- drops intents the user expressed mid-call,
- gets confused by Orby's hedging replies and follow-up questions,
- sometimes mirrors conversational phrasing as steps instead of synthesizing real tool calls.

The user wants the same result they'd get by long-pressing Orby, pasting the conversation, and saying "use this conversation to generate a plan" — i.e. a distillation step first, then planning.

## Fix

Insert a **transcript-distillation pass** between the call ending and `plan-compose`. The distiller is a small LLM call that reads the full transcript and outputs a clean, enumerated request brief listing every concrete intent the user expressed. That brief — not the raw transcript — becomes `plans.user_request`, and the existing planner runs against it unchanged.

### 1. New server function: `distillCallTranscript`

File: `src/lib/orby-call.functions.ts` (add alongside `chatWithOrby`).

- Input: `{ transcript: string }` (Zod-validated, capped length).
- Uses the same `createOpenAiProvider` / `gpt-5.5` setup already in this file.
- System prompt instructs the model to:
  - Read a voice transcript between the user and Orby.
  - Ignore Orby's filler/acknowledgement lines and questions.
  - Extract every concrete thing the user wants done, in the order they said it.
  - Output a single plain-text brief: a one-line summary followed by a numbered list of intents, each phrased as a direct imperative ("Add a sentence about X to the Y doc", "Generate an image of Z", etc.).
  - Preserve specific titles, names, and references the user mentioned verbatim so the planner's snapshot matcher can resolve them.
  - No markdown headings, no JSON — just the brief as plain text the planner will read.
- Returns `{ request: string }`.

### 2. Wire it into Call Mode

File: `src/contexts/CallModeContext.tsx`, `generatePlanFromConversationInternal` (~lines 553–587):

- Build the transcript as today.
- Call `distillCallTranscript({ data: { transcript } })` via `useServerFn` (lifted to module top with the other server fns).
- Use the returned `request` as `user_request` on the inserted `plans` row, prefixed with a short header like `Plan request distilled from a voice call with Orby:\n\n` so the planner knows the origin.
- If distillation fails (network/LLM error), fall back to the current behavior (raw transcript) so the user never loses their call — but show a toast noting the fallback.
- Keep the existing toast + `plan-compose` invocation. Approval flow is unchanged.

### 3. No schema / planner changes

`plan-compose` already does the right thing once it receives a clean request. No migrations, no edits to `supabase/functions/plan-compose/index.ts`, no changes to the approval UI.

## Technical notes

- The distiller runs client-initiated through a TanStack server function (same pattern as `chatWithOrby`), so it inherits `requireSupabaseAuth` and the existing AI gateway wiring. No new secrets.
- Cap transcript at ~16k chars before sending; truncate from the start if longer (recent turns matter more for plan intent).
- Keep the distiller's output cap modest (e.g. ask for ≤ ~1500 chars) so `plan-compose`'s snapshot budget isn't squeezed.
- Don't store the raw transcript separately — `plan_summary` after composition already gives the user a readable description, and the distilled brief is what they'll want to see if they inspect the plan.

## Files touched

- `src/lib/orby-call.functions.ts` — add `distillCallTranscript` server fn.
- `src/contexts/CallModeContext.tsx` — call the distiller before inserting the plan row; fall back on failure.
