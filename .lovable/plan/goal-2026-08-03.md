## Goal
Give Orby real document-editing power in chats and scheduled plans: find the exact part you mean, replace it, and truly delete sentences — but only when you actually asked for a deletion.

## What exists today (verified)
- Orby's editing tools are: create document, rename document, add sentence, update sentence content, move sentence, link sentence, and "mark for deletion" (prepends a trash emoji).
- There is no tool that actually deletes a sentence. Deleting is only simulated by marking.
- Chat requests route through the same plan tool catalog, so both chat and scheduled plans share these capabilities.
- Regular plans require your approval before running; scheduled plans are created already approved.

Note: the "it wiped the whole document when I asked for a replacement" behavior is not yet reproduced, so its cause is unconfirmed. Step 1 below investigates it against a real request before the rest is judged complete.

## Changes

### 1. Investigate the destructive replace
Trace a replace-style request through plan composition and step execution to see which steps get generated (e.g. clear-then-rewrite instead of targeted sentence edits). Fix the planning rules so "replace X with Y" becomes: locate the sentence, then update that sentence's content — never a bulk rewrite of the document.

### 2. New tool: delete_sentence
Add a `delete_sentence` tool (document_editing group) that permanently removes one sentence row by id, with ownership checks and index compaction so the document stays in order. Idempotent: if the sentence is already gone, it reports success instead of failing the plan.

The existing "mark for deletion" tools stay as the fallback for cases where you did not explicitly ask for a deletion. Whole documents and gallery media remain mark-only.

### 3. Deletion consent gate
`delete_sentence` is only allowed when your own request text contains a deletion word (delete, remove, erase, get rid of, take out, and close variants).
- Planning: if the request has no deletion word, the planner is instructed to use mark-for-deletion instead, and a validation pass rejects any plan containing `delete_sentence` for a non-deletion request.
- Execution: the step handler re-checks the plan's original request text before deleting. If the word isn't there, the step falls back to marking and says so.
- Scheduled plans: same rule against the schedule's saved request text, so a recurring task can only delete if the words were in the request you submitted.
- Since plans still need approval (and scheduled plans were approved when you created them), nothing deletes without your go-ahead.

### 4. Targeting rules for replace/remove
Strengthen the planner's rules so replace/remove requests must:
- first locate the target with sentence search or a document read,
- carry a concrete `sentence_id` in the mutating step,
- never touch sentences outside the ones matched.

### 5. Reporting in chat
Deletions are reported back explicitly in the chat summary — which sentences were removed and from which document — and when the consent gate downgrades a delete to a mark, the reply says that too.

## Technical notes
- `supabase/functions/_shared/tools.ts`: add `delete_sentence` definition + group mapping.
- `supabase/functions/plan-step/index.ts`: add the handler, required-arg entry, consent re-check, and result shape used for reporting.
- `supabase/functions/plan-compose/index.ts`: extend WHERE RULES with replace/delete targeting rules, add `delete_sentence` to required-target validation, and add the consent validation pass.
- Sentence ordering after delete is already handled by the existing after-delete compaction trigger; no schema change is needed.

## Out of scope
No changes to media/document deletion, the gallery, gestures, or chat UI layout.
