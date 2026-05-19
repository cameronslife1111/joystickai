# Make the planner tolerant of loose wording

## Why this keeps failing

`find_document_by_title({query: "Claude codex"})` runs `ilike '%Claude codex%'` in Postgres. That's a single contiguous substring — if the doc is titled "Claude Code Tips" or "Codex notes — Claude", zero rows come back, then `{{step_0.result[0].id}}` throws. Three layers are too literal:

1. **DB search tools** (`find_document_by_title`, `find_sentence_by_content`) — raw `ilike '%query%'`, no tokenization, no fallback. (`find_media_by_title` was already upgraded; copy that pattern.)
2. **Snapshot inlining** in `plan-compose` — picks which docs to inline using `reqLower.includes(title.toLowerCase())`. Same strict-substring trap. The doc shows up in the id list but its contents stay hidden, so the planner can't tell it's the right one.
3. **System prompt** — says "prefer ids from snapshot" but never forbids `find_*`, and doesn't tell the model "the user's wording will not match the title verbatim; pick the closest one yourself."

## What we'll change

### 1. `supabase/functions/plan-step/index.ts` — fuzzy search handlers

Replace `find_document_by_title` and `find_sentence_by_content` with the same token-scored approach `find_media_by_title` already uses:

- Tokenize the query, drop a small stopword set (`the`, `a`, `doc`, `document`, `note`, `sentence`, `about`, etc.).
- Pull a reasonable working set from Postgres using an `OR` of token-level `ilike` filters (over title for docs, content for sentences). If that returns nothing, fall back to fetching the user's most-recent N rows (200 docs / 500 sentences) so we still have candidates to score.
- Score each candidate by:
  - +2 per query token appearing as a substring of the haystack
  - +3 if the full normalized query appears as a substring (exact-ish bonus)
  - +1 for each shared *word* (whole-token match on a word boundary)
  - tiebreak by recency
- Return the top 5. **Never throw on "no matches"** — return `[]` only when the user genuinely has zero documents/sentences. The planner can still detect emptiness if needed, but the common case ("user phrased it loosely") now succeeds.
- Keep the existing `document_id` filter for `find_sentence_by_content`.

Side benefit: the friendlier "returned 0 results" template error in `resolvePath` stops triggering in normal use.

### 2. `supabase/functions/plan-compose/index.ts` — smarter snapshot

- **Inlining selection**: replace the `reqLower.includes(title)` filter with token-overlap scoring. Tokenize the user's request (same stopword set), and inline up to 6 docs ranked by (a) token overlap with the title, (b) token overlap with the title's words, (c) the origin document if any, (d) recency as tiebreaker. Always inline the origin document's full text when present.
- **Media ranking**: also rank `mediaList` by token overlap with the request before printing, so the most relevant assets appear at the top of the snapshot section (helps the LLM pick the right id when there are 100+ assets).
- **Stronger system-prompt guidance** (append, don't rewrite the existing rules):
  - "The user will refer to docs and media by rough description, not exact title. Pick the closest id from the WORKSPACE SNAPSHOT yourself using common-sense semantic matching — do NOT echo the user's phrasing into a `find_*` call when a plausible candidate is already listed."
  - "Only call `find_document_by_title` / `find_media_by_title` / `find_sentence_by_content` if the snapshot is empty OR none of the listed items is a plausible match. These tools now return fuzzy/scored results, so even when you do call them, treat result[0] as a best guess, not a guarantee."
  - "If the user's request doesn't clearly point at any document in the snapshot, prefer asking via `generate_text` or returning an `explanation` over guessing — never invent ids."

### 3. `supabase/functions/_shared/tools.ts` — refresh tool descriptions

Update the descriptions for `find_document_by_title` and `find_sentence_by_content` to say "fuzzy token-scored match — tolerates loose wording" so the planner trusts looser queries. Keep arg schemas unchanged.

## Out of scope

- No DB schema changes, no new tables, no `pg_trgm` extension (keeps it self-contained and avoids a migration).
- No UI changes — purely planner-side intelligence.
- Not changing the LLM model.

## Technical notes

- Token regex: `/[^a-z0-9]+/i`, lowercase, length ≥ 2.
- Stopwords shared between tools and the composer — extract a small helper near the top of `plan-step/index.ts` and duplicate the constant in `plan-compose` (these are isolated edge functions; a `_shared` constant file is fine if cleaner).
- Working-set cap: 200 docs, 500 sentences, 200 media — bounded so the scoring loop stays O(n) on small numbers.
- All existing `{{step_N.result[0].id}}` template references continue to work because tools still return arrays in the same shape.

## Verification

- Manually invoke `plan-compose` via `stack_modern--invoke-server-function` with a request whose wording doesn't match any title verbatim (e.g. "Read the claude codex doc and add a summary at the top"), confirm the resulting plan uses the right doc id directly (no `find_*` step), or that the `find_*` step it does emit now returns a non-empty array.
- Check `supabase--edge_function_logs` for both functions after the test run.
