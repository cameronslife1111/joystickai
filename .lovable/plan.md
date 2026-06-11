# Isolate plan context so new plans stop pulling in old work

## The root cause

The planner LLM is already stateless per plan — it never receives another plan's steps, summary, or outputs. The bleed comes entirely from the **WORKSPACE SNAPSHOT** that `supabase/functions/plan-compose/index.ts` rebuilds for every plan. Today that snapshot:

1. Inlines the **full text** of any document whose title scores `> 0` against the request — and `score > 0` triggers on a *single* loose token match (e.g. "video", "image", "part"), so unrelated docs from earlier plans get injected as "REFERENCED DOCUMENTS."
2. Dumps the **entire** `ALL DOCUMENTS` list (up to 2000 titles) and `ALL MEDIA` list (up to 200 items, with source text) into every prompt, regardless of relevance.
3. Has no instruction telling the planner to ignore documents/media the user didn't actually reference.

Because your tickets reuse generic titles ("Generate First Frame Images (Part 2)"), token overlap with prior plans is huge, so the planner keeps surfacing old content. Earlier plans are preserved exactly as they are — this only changes what context a *new* plan sees.

## The fix (all in `supabase/functions/plan-compose/index.ts`)

### 1. Raise the inline-relevance bar
Only inline a document's full text when it is genuinely referenced:
- Always inline **attached** documents (unchanged — explicit user intent).
- For score-matched docs, require a **strong** match instead of `score > 0`: a title substring/phrase hit, or **2+ distinct meaningful token matches** (not stopwords). A single generic shared word no longer inlines a doc.
- Keep the cap at the top few matches.

This stops unrelated prior-plan docs from being injected as primary context.

### 2. Trim the enumerated lists to what's relevant
- `ALL MEDIA`: instead of listing 200 items, list attached/most-relevant media (top ~25 by score) plus a note that more exist and can be found via `find_media_by_title`. Droping the long tail of old generations removes the biggest source of "old stuff."
- `ALL DOCUMENTS`: keep the id–title catalog (it's needed so the planner can resolve references and handle "act on all matching docs"), but relabel it clearly as a **reference catalog**, and detect bulk intent: only when the request actually asks to act on "all/every … matching" docs do we present the full list as actionable; otherwise it stays a lookup table.

### 3. Add an explicit ISOLATION instruction to the planner system prompt
Add a rule stating: this plan is independent; do **not** carry over goals, content, titles, or steps from any previous request or from any document/media the current request did not name or clearly describe; if the request doesn't reference an item, don't act on it. This reinforces the snapshot changes at the model level.

## What stays the same
- All existing/older plans, their logs, statuses, and steps are untouched.
- Attached-document behavior, template wiring (`{{step_N...}}`), tool catalog, and the executor (`plan-step`) are unchanged.
- Bulk "act on every matching doc" requests still work via the catalog + `find_documents_by_title`.

## Verification
- Deploy the updated `plan-compose` function.
- Submit a fresh, unrelated plan and confirm the generated steps/summary reference only the current request's targets (no carryover from prior tickets).
- Submit a plan with attached docs and confirm those still inline correctly.
- Submit a "do X to all docs named …" request and confirm bulk enumeration still works.

## Technical notes
- Single file changed: `supabase/functions/plan-compose/index.ts` (snapshot builder + `systemPrompt`).
- No schema, RLS, or client changes required.
