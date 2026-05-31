## Goal

Let Orby reliably find and act on **all** documents matching a description (e.g. "every doc starting with Ricky - Prompt - Get 10"), even when the user has hundreds of documents, and support bulk operations like "add all those titles to one document."

## Root cause (confirmed)

1. `plan-compose/index.ts` builds the planner's WORKSPACE SNAPSHOT from only the **200 most-recently-updated** documents (`.limit(200)`). The user has 390 docs; 28 of 31 "Ricky - Prompt" docs are outside that window, so the planner never sees them and refuses.
2. `find_document_by_title` returns only the top **5** matches, and plans have no loops — so "page 5 at a time" is structurally impossible. Bulk enumeration must come from the snapshot or a dedicated bulk tool.

## Changes

### 1. `supabase/functions/plan-compose/index.ts` — make the full title list visible
- Raise the `allDocs` query `.limit(200)` to `.limit(2000)` so the **ALL DOCUMENTS (id — title)** section lists every document. This is just id + title (cheap — ~390 lines, well within prompt budget), not full content.
- Keep the **inlined full-content** sections bounded as they are today (still the forced attachments + top ~6 scored docs), so the prompt doesn't blow up. Only the lightweight id—title list grows.
- Raise the media `.limit(200)` similarly only if needed; leave as-is for now to keep scope tight.

### 2. `supabase/functions/_shared/tools.ts` — add a bulk enumeration tool
Add a new tool `find_documents_by_title` (plural) to `TOOL_CATALOG`:
- Description: returns **all** documents whose title matches a prefix/substring/keywords (not capped at 5), best-effort ordered, for bulk operations. Notes that the single `find_document_by_title` is only for locating one target.
- Args: `query` (required), optional `limit`.

### 3. `supabase/functions/plan-step/index.ts` — implement the handler
Add a `find_documents_by_title` handler mirroring `find_document_by_title`'s scoring, but:
- Returns all candidates with score > 0 (or substring match), sorted, capped at a safe ceiling (e.g. 100) instead of 5.
- Returns `[{ id, title }]` so later steps can reference results.

### 4. `supabase/functions/plan-compose/index.ts` — planner prompt guidance
Add rules to `systemPrompt`:
- For requests that target **all documents matching a description** ("every doc starting with X", "all the Ricky prompt docs"), enumerate the matching titles **directly from the ALL DOCUMENTS list** in the snapshot and emit one step per match (e.g. one `add_sentence` per title). Do **not** use `find_document_by_title` for enumeration — it only returns the 5 best matches.
- Clarify there is **no five-result limit** when reading titles from the snapshot; the 5-cap only applies to the single-target fuzzy finder.
- If the matching set is too large to enumerate inline, use the new `find_documents_by_title` tool.

## Result for the user's example
With the full title list visible, the planner can read all 25 "Ricky - Prompt - Get 10…" titles from the snapshot and produce a plan that: (a) adds the emoji-legend header sentences to the "Ricky Context Meme Tracker" doc, then (b) emits one `add_sentence` per matching title — all in a single approved plan, no manual "5 at a time" needed.

## Notes
- No database schema changes, no new secrets.
- No step-count cap exists, so ~25+ add steps execute fine via the existing tick loop.
- Changes are isolated to the three plan/edge-function files; no frontend or unrelated planner behavior changes.