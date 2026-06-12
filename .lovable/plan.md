# Fix Orby Planning: Robust Document Lookup + Runtime Looping

## What's broken today

Three concrete regressions/limitations make your action tickets fail:

1. **Emoji & symbol blindness.** Every search and scoring function tokenizes with `split(/[^a-z0-9]+/)`, which deletes 🔴 / 🔵 and all punctuation. So "the doc that starts with the blue circle" or "lowest X shortcode" can never be resolved — the matcher literally cannot see emojis or symbols. Shortcodes like `X597` survive as tokens but there's no logic to compare them numerically.

2. **Context docs no longer get read.** The recent isolation work capped full-text inlining at 6 documents behind a strict 2-token match. Your tickets reference several context docs (the brain-dump instructions, the series rules) whose contents the planner now usually never sees, so it can't actually follow them.

3. **No runtime looping.** The composer emits a *fixed* step list in one pass. Tickets like "generate one first-frame image for each shot" can't be expressed, because the number of shots is only known after a document is read at run time.

The fix keeps the strict media-reuse isolation (old images won't resurface) untouched.

## The plan

### 1. Emoji / shortcode / prefix-aware matching
`supabase/functions/_shared/` + both edge functions:

- Add a shared `lookup.ts` helper with:
  - `leadingEmoji(title)` — extracts the first emoji/symbol cluster of a title.
  - `extractShortcode(title)` — pulls a code like `X597` (pattern `/\b[A-Z]\d{2,5}\b/`) and its numeric part for ordering.
  - An emoji synonym map so natural language resolves to glyphs: "blue circle"→🔵, "red circle"→🔴, "green"→🟢, "yellow"→🟡, "purple"→🟣, "check/checkmark"→✅, "fire"→🔥, "laughing/laugh/😂"→😂, etc. (extensible, not hardcoded to your specific titles).
  - An emoji-preserving tokenizer used for scoring (keeps emoji glyphs and the shortcode token instead of stripping them).
- Update `find_document_by_title`, `find_documents_by_title`, and `find_sentence_by_content` in `plan-step/index.ts` to match on leading emoji and shortcode in addition to word tokens, and to translate emoji-name phrases in the query to the actual glyph before matching.

### 2. Make the catalog self-describing so the planner can reason
`supabase/functions/plan-compose/index.ts`:

- The DOCUMENT CATALOG already lists every title. Enrich each line with parsed fields so selection logic is trivial for the model:
  `  <id> — "🔴 Ava - Context - X597 - XYZ - Video Brain Dump"  (emoji=🔴, code=X597)`
- Add planner guidance covering the patterns your tickets use: select by leading emoji, pick the **lowest** shortcode among matches, match partial/loose titles, and resolve emoji descriptions ("blue circle") via the synonym map. No titles are hardcoded — this is general matching guidance.

### 3. Restore context-document reading
`plan-compose/index.ts`:

- Raise the full-text inline cap from 6 to ~12 and always inline any doc whose title appears (loosely) in the request, so named context docs come through.
- Add explicit guidance: when a referenced context/rules doc is *not* inlined, emit a `read_document` step for it and pipe its text into later steps via `{{step_N.result.text}}` (already supported by the executor). This is what lets Orby actually "read these documents and then fill out the brain dump."

### 4. Runtime looping via a new `expand_plan` tool
This is the structural change that makes "for each shot/idea" possible without knowing the count up front.

- Add `expand_plan` to the tool catalog (`_shared/tools.ts`). Args: `instruction` (what to do for each item), and `context` (template refs like `{{step_N.result.text}}` feeding the brain dump / rules into the expansion).
- In `plan-step/index.ts`, handle `expand_plan` specially: at execution time it calls the planner LLM with the resolved context (e.g. the brain-dump text already read in a prior step), the full tool catalog, and the live workspace snapshot, and returns a fresh list of sub-steps (e.g. one `remix_images` + one `rename_media` per shot).
- The executor **splices** those generated sub-steps into the plan's `steps` array immediately after the current step, persists, and continues — reusing the existing per-step claim/await-media/advance machinery. The LLM is told the absolute base index so its `{{step_N...}}` references resolve correctly; generated steps are validated through the same `REQUIRED_TARGET_ARGS` guard used at compose time.
- Existing safety caps (`MAX_TICKS`, watchdog, no-progress, per-media wall clock) already bound runaway expansion; add a cap on generated sub-steps per expansion as defense in depth.

### 5. Keep media isolation strict (unchanged)
The reuse-intent + `strongMediaMatch` gating in `plan-compose` stays exactly as is, so repeated/scheduled runs still won't drag back old generated images. New images come from `generate_image` / `remix_images` with fresh prompts.

## Verification

- Deploy `plan-compose` and `plan-step`.
- Unit-style checks on the new `lookup.ts` helpers (emoji extraction, shortcode ordering, synonym resolution).
- Compose a test plan against a request that names a doc by emoji + "lowest shortcode" and confirm the catalog lines expose `emoji=` / `code=` and the chosen step targets the right id.
- Run an `expand_plan` flow end-to-end (read a doc → expand into per-item steps) via `curl_edge_functions` and confirm sub-steps splice and execute.
- Confirm a pure "generate a cat image" repeat run still does NOT reuse a prior asset (isolation intact).

## Technical notes

- Splicing into `steps` mutates the stored array; `current_step` keeps pointing at the next index, so no index math breaks for already-completed steps. Generated sub-step templates use absolute indices supplied at expansion time.
- `expand_plan`'s LLM call reuses the same `callPlannerLLM` provider/model config already in `plan-compose` (extracted into the shared module or duplicated minimally in `plan-step`).
- Emoji handling uses `Intl.Segmenter`/`\p{Extended_Pictographic}` so multi-codepoint emoji (skin tones, ZWJ) are treated as one cluster.
