## Goal
Make Orby plans independent from whatever document or sentence you currently have open. The planner should use only your request plus your workspace data, and only act on a specific document/sentence when you explicitly describe it with fuzzy matching.

## Plan
1. Remove current-context injection from plan creation.
   - Stop writing `origin_document_id` and `origin_sentence_index` when a new plan is created.
   - Keep the plan request as plain user intent only.

2. Remove active document and current sentence from the planner prompt.
   - Delete the `ORIGIN CONTEXT` section in `plan-compose`.
   - Stop sending `active_document_id`, `active_document_title`, `current_sentence_id`, `current_sentence_text`, and `current_sentence_position` to the AI.
   - Keep the workspace snapshot limited to the user’s documents/media and relevant inlined content, ranked by fuzzy relevance to the request.

3. Tighten the planner instructions so it never assumes “current”.
   - Update the system prompt to explicitly say the planner must not use the user’s current document or cursor position unless the request itself refers to one by description.
   - Prefer fuzzy matching against document titles/content and media metadata from the snapshot.
   - If the request does not identify a target clearly enough, return an explanation instead of guessing.

4. Remove implicit current-position behavior from plan tools where it affects planning reliability.
   - Audit planner-facing tool descriptions that encourage `after_current` behavior.
   - Change defaults so generated plans prefer explicit targets like `top` or `bottom` unless the user clearly asks for placement relative to a specific sentence.
   - Keep fuzzy lookup tools as the path for locating the intended doc/sentence from your wording.

5. Validate that plan execution still works without origin context.
   - Check that approval, running, and failure flows still function when plans are created with no origin doc/sentence.
   - Verify common cases like: “move steps from Cameron Inbox into 45A”, “search the web and add results to a doc”, and “use the Claude/Codex doc” all resolve by fuzzy matching rather than active-editor state.

## Technical details
- Files likely to change:
  - `src/components/PlanComposerDialog.tsx`
  - `supabase/functions/plan-compose/index.ts`
  - `supabase/functions/_shared/tools.ts`
  - possibly `supabase/functions/plan-step/index.ts` if any tool behavior still depends on `after_current` in planner-generated runs
- Existing plan records can keep their old fields in the database; the change is about stopping new plans from depending on them.
- This keeps the planner grounded in your actual request and reduces false assumptions caused by whatever doc/cursor happened to be open when you launched the plan.