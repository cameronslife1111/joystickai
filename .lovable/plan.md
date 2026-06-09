# Upgrade Orby's Planner: Never Lose the "Where"

## Problem

When Orby plans, the *what* of each step survives but the *where* (which document the text goes into / comes from) gets lost. The planner relies on fuzzy snapshot matching and template piping, but nothing forces each step to lock in an explicit, resolved destination. Result: steps execute against the wrong doc, or fail because a target was never carried through.

Planning is the root of every plan's success, so we harden it at two levels: a stronger planner prompt (so the model commits the destination into every step), and a deterministic validation pass (so any step missing a resolvable target is caught before the plan is shown/approved).

## Changes

All work is in the backend planner. No UI or schema changes.

### 1. Strengthen the planner system prompt — `supabase/functions/plan-compose/index.ts`

Add a new, prominent rules block (call it "WHERE RULES — every step must lock its target") to the `systemPrompt`, stating:

- **Every mutating step must carry its full destination explicitly.** For `add_sentence`, `move_sentence`, `update_sentence_content`, `link_sentence_to_document`, `mark_*`, `rename_*`, image/video tools — the target `document_id` / `sentence_id` / `target_document_id` / `source_media_id` must be present in that step's `args`, resolved to a concrete id (from the WORKSPACE SNAPSHOT) or a template (`{{step_N.result.id}}`) from an earlier step. Never leave a destination implied by an earlier step's prose.
- **New-doc → fill pattern is explicit.** When the plan creates a document and then adds content, every following `add_sentence` MUST set `document_id: "{{step_N.result.id}}"` pointing at the `create_document` step. Do not assume "the document we just made" — wire it through the template.
- **Each step's `description` must name the destination in plain language** (e.g. "Add the intro line to the *Trip Plan* document", not "Add the intro line"). The user reads these during approval and they double as a self-check.
- **One destination per step.** If content belongs in multiple docs, emit one step per doc, each with its own explicit `document_id`.
- **Resolve before you reference.** If a target doc doesn't exist yet and isn't created earlier in the plan, create it first (a `create_document` step) and template its id forward — never invent an id and never point at an unresolved name.

Reinforce within the existing template-syntax bullets that `create_document` / `add_sentence` return objects with an `id`, and `document_id: "{{step_N.result.id}}"` is the canonical way to target a freshly created doc.

### 2. Sharpen the tool descriptions — `supabase/functions/_shared/tools.ts`

Tighten the `description` for the mutation tools so the requirement travels with each tool definition the model sees:

- `add_sentence`, `move_sentence`, `update_sentence_content`, `link_sentence_to_document`: append a line — "The target document/sentence id is REQUIRED and must be a concrete id from the snapshot or a `{{step_N.result.id}}` template; never rely on an implied/previous target."

### 3. Deterministic validation pass after the LLM returns — `supabase/functions/plan-compose/index.ts`

In the step-normalization loop (where each step's `tool` is validated), add a per-tool required-target check. For each tool, define which args must be non-empty (e.g. `add_sentence` → `document_id` + `content`; `move_sentence` → `sentence_id` + `target_document_id`; `update_sentence_content` → `sentence_id` + `new_content`; image/video tools → their `source_*` ids). If a required target arg is missing/blank AND is not a `{{step_N...}}` template, throw a clear compose error (which already routes the plan to `failed` with an explanatory message) — e.g. "Step 3 (add_sentence) is missing a target document_id." This guarantees a plan never ships with a lost destination.

A template string (`{{step_N.result...}}`) counts as present, since it resolves at execution time.

## Technical Details

- `plan-compose/index.ts`: edit the `systemPrompt` constant (add the WHERE RULES block + reinforce template guidance), and extend the `for (const [i, s] of steps.entries())` validation loop with a required-args map keyed by tool name.
- `_shared/tools.ts`: edit `description` strings for the four sentence/document mutation tools.
- Required-args map should be derived to stay in sync with `TOOL_CATALOG` where practical, but an explicit per-tool target map is fine and clearer for the "must be a real destination" rule.
- No changes to `plan-step` execution, the snapshot builder, RLS, or the DB. Behavior change is entirely "plans are written more precisely and rejected if a destination is missing."

## Out of Scope

- No changes to how steps execute or to template resolution logic.
- No UI changes to the approval/retry dialogs.
- No new tools or model/provider changes.