## 1. Media Gallery can't scroll on mobile

**Root cause:** `src/styles.css` sets `body { overflow: hidden; height: 100% }` globally — required for the swipe-driven app page, but it traps the Media Gallery, whose `<main>` is `min-h-[100svh]` (taller than the viewport once the grid grows) but can't scroll because the body clips it.

**Fix (frontend only, `src/routes/_authenticated/media.tsx`):** make `<main>` itself the scroll container.

- Change `min-h-[100svh] flex-col` → `h-[100svh] flex-col overflow-y-auto overscroll-contain`
- Sticky top bar already uses `sticky top-0` and will continue to work inside a scrolling container.
- Floating "Generate" FAB is `fixed`, unaffected.
- Full-screen viewer overlay is `fixed inset-0`, unaffected.

No global CSS changes — the app page's no-scroll behavior stays intact.

## 2. Planner fails on `remix_images` / `regenerate_image` when piping a document's text into the prompt

**What actually happened in the failing plan:**
- Step 0: `read_document` on "Cameron Inbox" → returned `{ id, title, sentences: [{id, order_index, content}, ...] }`.
- Step 1: `remix_images` with `prompt: "... {{step_0.result.sentences}}"`.

The template resolver stringifies an array of sentence objects to `"[object Object],[object Object],..."` and forwards that as the prompt. fal's `gpt-image-2/edit` then rejects the request (422 Unprocessable Entity), and the user sees a generic "Unprocessable Entity" with no clue why. The picture is "the planner picked the wrong template path" — exactly the loose-pattern-matching gap the user described.

This isn't about dimensions (already coerced away from `auto` in a prior fix) and isn't about the source images (manual remix works). It's about the **document → prompt** wiring.

### Fixes (all in `supabase/functions/`):

**A. Make `read_document` directly usable as a string. (`plan-step/index.ts`)**

Return an extra `text` field: the sentences joined with `\n`. Existing `sentences` array stays for tools that genuinely need row ids.

```ts
return {
  id: doc.id,
  title: doc.title,
  text: (sents ?? []).map((s) => s.content).join("\n"),
  sentences: sents ?? [],
};
```

Now `{{step_0.result.text}}` is a clean drop-in for any prompt arg.

**B. Harden the template resolver. (`plan-step/index.ts` → `resolveTemplates` / `resolvePath`)**

When a `{{ ... }}` placeholder appears inside a larger string and the resolved value is not a primitive:

- If it's an array of `{content: string}` objects → auto-join `content` values with `\n` (recovers older plans that referenced `.sentences`).
- If it's an array of strings → join with `\n`.
- Otherwise → throw a clear error: `Template {{step_N.path}} resolved to an object/array; pipe a string field (e.g. step_N.result.text) instead.`

This converts a silent garbage-prompt into a loud, debuggable failure and rescues the common "I referenced sentences" mistake.

**C. Teach the planner the right pattern. (`plan-compose/index.ts` system prompt + `_shared/tools.ts` description)**

- Update `read_document`'s catalog description: explicitly document the new `text` field and tell the planner to use `{{step_N.result.text}}` when wiring a doc's content into a downstream string arg. Forbid `{{step_N.result.sentences}}` for prompts.
- Add one sentence to the planner system prompt: "When piping a document into a media tool's prompt: prefer the inlined text from the WORKSPACE SNAPSHOT; if the doc isn't inlined, call `read_document` and reference `{{step_N.result.text}}` — never `.sentences`."

**D. Improve `find_media_by_title` fuzziness for the "this image / that image" case. (`plan-step/index.ts`)**

Today it matches `title ILIKE %q%` OR `generation_params.user_text ILIKE %q%`. Add tokenized matching: split the query on whitespace, drop stop-words (`the`, `a`, `an`, `image`, `photo`, `reference`, `pic`), and OR-match each remaining token against title + source_text. Sort by number of tokens matched, then recency. This makes phrases like "the cat image" or "full body size reference" land on the right asset without exact-title matches.

### Out of scope (intentionally)

- No DB migration.
- No edits to `edit-image`, `generate-image`, fal model selection, or aspect-ratio handling — those work in manual flows.
- No UI changes outside the Media Gallery scroll fix.

## Files touched

- `src/routes/_authenticated/media.tsx` — scroll container.
- `supabase/functions/plan-step/index.ts` — `read_document.text`, resolver hardening, `find_media_by_title` tokenized search.
- `supabase/functions/_shared/tools.ts` — `read_document` description update.
- `supabase/functions/plan-compose/index.ts` — one-line planner prompt addition.
