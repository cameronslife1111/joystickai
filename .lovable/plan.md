# Supercharge Orby Plan Mode with structured per-step reasoning

## Goal
Right now the planner emits each step as just `{ tool, args, description }`. The model decides the "where/what/how" only implicitly, so it drifts: wrong documents, vague transforms, output landing nowhere. We'll force the planner to fill a strict reasoning contract for **every step**, validate it server-side, and show it to the user at approval — without changing how steps execute.

## What changes (the per-step contract)
Every step gains a required `io` object the planner must complete before the step is accepted. The fields map exactly to what you asked for:

```text
io: {
  inputs:      "what data / media this step uses (named docs, media ids, prior step outputs, or 'none')",
  inputSource: "WHERE each input comes from — a concrete workspace id, a {{step_N...}} ref, or 'user request'",
  operation:   "how the data/media is used and transformed on this step (the actual action)",
  output:      "what this step produces — e.g. 'new image asset', 'updated sentence', 'document text', 'web results', 'nothing persisted'",
  destination: "WHERE the output goes — a concrete target id / new doc / media gallery, or 'feeds step_M'",
  capability:  "which tool/capability is used and why it's the right one",
  lookup:      "if a lookup is needed first: what to look up and what to do with the result; else 'none'"
}
```

The step description stays, but is now derived from `io` so it always names the source and destination in plain language.

## File-by-file

### `supabase/functions/plan-compose/index.ts`
1. **System prompt — add a "PER-STEP REASONING CONTRACT" block** (the core of this request). It instructs the model that before choosing args for any step it must reason through, and emit, the `io` object above. Add explicit rules:
   - Every input in `io.inputs` must have a matching concrete id or `{{step_N...}}` reference in `io.inputSource` AND in the step's actual `args` — no input may be "implied".
   - If `io.lookup` is not "none", there MUST be an earlier `find_*`/`read_document`/`web_search` step, and its result must be referenced via template — never act on a described-but-unresolved item.
   - `io.destination` must resolve to a real target id, a `create_document` step's id, or the media gallery; it must match the mutating arg (`document_id`/`target_document_id`/`media_id`/etc.).
   - `io.capability` must be one of the catalog tools and must be the narrowest correct tool (reuse the existing IMAGE TOOL DECISION GUIDE).
   - A "self-check before emitting" instruction: restate the request's target for this step, confirm the id is in the snapshot, confirm output destination — mirroring "what document am I using, where does the output go".
2. **Update the JSON output shape** in the prompt to include `io` on each step, with a filled example.
3. **Validation pass (deterministic, after parse)** — extend the existing loop:
   - Require `io` to be an object with non-empty `inputs`, `operation`, `output`, `destination`, `capability` (lookup may be "none"). Reject the plan with a precise message if missing, so the failure is caught at compose time (consistent with current `REQUIRED_TARGET_ARGS` behavior).
   - Cross-check `io.capability` against `s.tool` (must match the tool name).
   - Keep the existing required-target-arg checks (they already enforce the "where" in `args`); the `io` check is the reasoning layer on top.
   - If `description` is blank, synthesize it from `io` (`"<operation> → <destination>"`) instead of the generic `Run <tool>`.

### `supabase/functions/_shared/tools.ts`
No tool signature changes. Add one short sentence to the catalog preamble (via the prompt, not schemas) is handled in compose; tools file stays as-is unless we want the `io` note echoed — not required.

### `src/components/PlanApprovalDialog.tsx`
Surface the new reasoning so you can see the planner is thinking correctly during approval. Under each step's `description`, render a compact `io` breakdown (Uses / Does / Output → Destination / Looks up) in muted text when `s.io` exists. Falls back gracefully to just the description for older plans.

### `src/components/PlanDetailDialog.tsx`
Same compact `io` breakdown rendered per step (read-only), so running/finished plans also show the structured reasoning.

## Execution safety
- `plan-step` only reads `s.tool` and `s.args`, so adding `s.io` is inert at execution time — zero risk to the run path.
- Scheduled plans use the same composer, so they get the stricter reasoning automatically.
- The new validation rejects sloppy plans at compose time (status `failed` with a clear message) rather than letting them run wrong — this is the behavior that makes lookups reliable.

## Verification
1. Deploy `plan-compose`, then use the edge-function curl tool to compose a few representative requests (a doc edit naming a colored-circle title, an image remix, a "for each shot" runtime loop) and confirm each returned step has a complete, sensible `io` block and resolves to the correct ids.
2. Confirm the approval dialog shows the reasoning breakdown in the preview.
3. Run a scheduled plan path once to confirm auto-approve still works with the new validation.

## Out of scope
No changes to lookup scoring math, tool execution, or the runtime loop mechanics — this turn is purely about making the planner's per-step thinking explicit, strict, and validated.
