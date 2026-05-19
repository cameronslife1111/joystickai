
## Goals

1. **Speak naturally** — references like "the prompt in the Cameron inbox" should just work. The planner should already know what's in the documents and media the user mentions, instead of guessing fragile search terms like `find_sentence_by_content("prompt")`.
2. **Don't block the UI while planning** — the composer dialog should close immediately on submit, the user can keep working, and a toast announces when the plan is ready to review (same pattern as the "completed" / "failed" toasts).
3. **Pull content out of documents reliably** — when the user says "use the prompt from X", the planner should be able to read the document's contents and pass the actual text into the next step's args, not chain fragile string searches.

## Design (first principles)

The current planner is reasoning blind. It sees a tool catalog but not the user's actual data, so its only move when a doc/media is mentioned is "find by title → find by content → hope". The remix failure is the predictable outcome — there is no sentence literally containing the word "prompt", so `find_sentence_by_content("prompt")` returns empty.

Fix it by giving the planner the data **before** it plans, plus a clean way to read a doc on demand.

### A. Context-aware planner (`plan-compose`)

Before calling the LLM, gather a structured **workspace snapshot** and inject it into the system prompt:

1. List **all of the user's documents** (id + title) — small and cheap. The planner can resolve "Cameron inbox" to the right id by simple title matching in its head.
2. For each document whose title appears as a case-insensitive substring of the user's request, fetch **all sentences** (id, content, order) and inline them. This is the key change — when the user says "the Cameron inbox", the full text of that doc is right there in the prompt.
3. Fetch **all media assets** (id, title, kind, optional source prompt). Small per row, and lets the planner resolve "the Cameron reference image" + "the full body size reference image" to ids without needing `find_media_by_title` round-trips.
4. Keep the existing `origin_document_id` / `origin_sentence_index` context (active doc + current sentence) for pronouns like "this", "here".
5. Cap each injected doc at a sane size (e.g. first ~150 sentences / ~8KB) with a "…truncated" marker so very large docs don't blow the context window.

With this context the planner can:

- Skip `find_document_by_title` entirely when the user named a doc and we already injected its id.
- Inline the literal prompt text into `remix_images.prompt` instead of trying to "find a sentence".
- Resolve media ids directly without `find_media_by_title` steps.

### B. New `read_document` tool

For cases where the planner *does* still need to pull content at runtime (e.g. the user referenced a doc whose title didn't match any substring, or a doc was too large to fully inject), add a single, predictable tool:

```
read_document(document_id) → { id, title, sentences: [{ id, order_index, content }] }
```

This replaces the fragile "find a sentence containing the word X" pattern with a clean "give me the whole doc, I'll pick the right line." Subsequent steps reference its result with templates like `{{step_N.result.sentences[0].content}}`.

Update the system prompt so the planner prefers `read_document` over `find_sentence_by_content` whenever it needs the *content* of sentences (as opposed to locating a specific row to mutate). Keep `find_sentence_by_content` only for "find the row I want to edit/move/mark."

### C. Background plan composition

Stop showing the approval modal during composition. Flow becomes:

1. User submits the composer → row inserted as `status='composing'`, `plan-compose` invoked **fire-and-forget**.
2. Composer dialog closes immediately. Toast: "Orby is planning… (you can keep working)".
3. A new `useComposingPlansWatcher` hook (mirrors `useRunningPlansAdvancer` but watches `status='composing'` rows for the current user) polls / subscribes via realtime.
4. When a watched plan transitions to:
   - `proposed` → toast `"Plan ready — Review"` with an action button that opens `PlanApprovalDialog` for that id.
   - `failed` (during compose) → toast error with a "Details" action that opens the approval dialog showing the failure message.
5. The Approval dialog is now only ever opened on demand (from the toast action or from the AI Plans screen), never auto-opened on submit.

This matches the user's mental model: "fire and forget, ping me when it's ready" — same as the existing completed/failed toasts from `useRunningPlansAdvancer`.

### D. Tool catalog & prompt updates

- Add `read_document` to `_shared/tools.ts`.
- Update the planner system prompt to:
  - Describe the new workspace snapshot section.
  - Tell it: "If a document/media id is already present in the workspace snapshot, use it directly — do NOT call find_* tools."
  - Tell it: "To use the *content* of a document in a later step's args, either inline it directly from the snapshot or call `read_document`. Do NOT use `find_sentence_by_content` to fetch content."
  - Keep the existing rules about template syntax and refusal.

## Files to change

**Backend**
- `supabase/functions/plan-compose/index.ts` — build workspace snapshot (docs list, full sentences of referenced docs, media list), inject into system prompt, update prompt guidance.
- `supabase/functions/_shared/tools.ts` — add `read_document` definition; minor wording updates on `find_sentence_by_content` to nudge correct usage.
- `supabase/functions/plan-step/index.ts` — add `read_document` handler (returns id, title, sentences[]).

**Frontend**
- `src/components/PlanComposerDialog.tsx` — on submit: insert row, fire compose, close immediately, toast "Orby is planning…". Remove the `onPlanProposed` auto-open behavior.
- `src/hooks/use-composing-plans-watcher.ts` *(new)* — polls + realtime-subscribes to the user's `composing` plans; fires toasts with "Review" / "Details" actions on transition to `proposed` / `failed`.
- `src/routes/_authenticated/app.tsx` — mount the new watcher hook alongside `useRunningPlansAdvancer`; wire the toast action to open `PlanApprovalDialog` with the given plan id.
- `src/components/PlanApprovalDialog.tsx` — no behavioral change needed (it already handles `composing` / `proposed` / `failed`), but it's now only opened on demand.

## Out of scope

- No deletion tools (still forbidden).
- No change to the runtime executor's template/error handling — those messages are already good.
- No embeddings/semantic search yet; substring title match + full-doc injection covers the stated use case and avoids new infra. We can add embeddings later if doc counts grow large.

## Acceptance check

Replay the failing request: *"Use the prompt in the Cameron inbox, attach the Cameron reference image and the full body reference image from the gallery, and remix into a new image in the inbox."*

Expected plan after the fix:
1. `read_document(<Cameron inbox id from snapshot>)` — or planner inlines the prompt directly from the snapshot and skips this step.
2. `remix_images(source_media_ids=[<Cameron ref id>, <full body ref id>], prompt=<literal prompt text>)` — ids resolved from the media snapshot, prompt taken from the doc.
3. `add_sentence(document_id=<Cameron inbox id>, content="<media link or note for {{step_2.result.id}}>")` if the user wants the result recorded in the doc.

No more `find_sentence_by_content("prompt")`.
