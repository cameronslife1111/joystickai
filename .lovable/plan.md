## Goal

When viewing a document, Orby reads it and proposes the 4 highest-leverage, tool-grounded plan suggestions. A small orb appears top-left: **gray** while thinking, **yellow** when suggestions are ready. Tapping it opens a popup of the 4 suggestions; tapping one instantly creates and auto-approves a plan that runs and is logged in AI Plans exactly like a manual submission.

## How it fits the existing system

- Manual plans already work like this: a `plans` row is inserted with `status: "composing"`, then `plan-compose` generates steps. The existing `useComposingPlansWatcher` (already mounted in `app.tsx`) auto-approves any composing plan once it becomes `proposed` with steps and kicks off `plan-step`. So a tapped suggestion only needs to insert a `composing` plan with `user_request` = the suggestion's request text and `attached_document_ids: [activeDocId]` — the watcher handles approval, running, logging, and the "Plan started" toast. No new approval path needed.
- Suggestion generation reuses the OpenAI provider pattern already in `src/lib/chat.functions.ts` (`createOpenAiProvider` + `OPENAI_API_KEY`), so no new secret is required.

## Behavior (per your answers)

- **Generate on open + manual refresh**: suggestions generate when you open/switch to a document, cached per document via React Query. A small refresh control re-runs on demand.
- **Run instantly**: tapping a suggestion immediately creates + auto-approves the plan and closes the popup.
- **Tool-grounded only**: the generator is constrained to Orby's real capabilities (docs, sentences, web search, text/image/video generation), so every suggestion can execute.

## Changes

### 1. New server function — `src/lib/plan-suggestions.functions.ts`
- `suggestDocumentPlans` (`createServerFn`, `requireSupabaseAuth`), input `{ documentId: uuid }`.
- Loads the document title + sentences (ordered) via the request-scoped Supabase client (RLS-safe).
- Calls the OpenAI provider with a system prompt that:
  - Explains it produces the **top 4** high-leverage things Orby can do for the user based on this doc.
  - Notes that to-dos are usually near the top, and to detect where steps/tasks begin (numbered, bulleted, checklist `[ ]`, or paragraph steps) and base each suggestion on an actual task/step.
  - For a checklist/task doc: each suggestion targets a real task. For a context doc: suggestions are useful actions derived from the content.
  - Restricts suggestions to Orby's tool capabilities (create/rename docs, add/move/update/mark sentences, link, web search, generate text/image/video, regenerate/remix). No deletion (only mark-for-deletion exists).
  - Returns JSON `{ suggestions: [{ label, request }] }` (max 4): `label` = short button text (~6 words); `request` = a clear instruction phrased like a manual plan request (referencing the doc by title so the planner resolves it).
- Validates/normalizes output, caps at 4, returns `{ suggestions }`. Empty array if nothing actionable.

### 2. New component — `src/components/DocSuggestionsOrb.tsx`
- Props: `documentId`, `documentTitle`, `onPickSuggestion(request: string)`.
- React Query keyed `["doc_suggestions", documentId]`, `enabled: !!documentId`, `staleTime: Infinity` (cache until manual refresh / doc change), calling `suggestDocumentPlans` via `useServerFn`.
- Renders a small orb button (fixed top-left, safe-area aware, `z`-layered below modals): **gray + subtle pulse** while `isFetching`/no data; **yellow + soft glow** when suggestions are ready (length > 0). Hidden when no document is active or the result is empty.
- Click opens a Popover/sheet listing the 4 suggestions as tappable rows (label text). Tapping a row calls `onPickSuggestion(request)` and closes the popup. Includes a small "Refresh suggestions" control (`refetch`).
- Styled with semantic tokens; yellow uses the existing accent treatment used elsewhere (matches the "Call Orby" yellow), not raw colors in logic.

### 3. Wire into `src/routes/_authenticated/app.tsx`
- Render `<DocSuggestionsOrb>` inside the main app container (alongside the existing header/orb), passing `activeDoc.id` and `activeDoc.title`. Only shown when a document is open and not in composing/overlay-blocking states.
- `onPickSuggestion(request)`: reuse the same insert logic as `PlanComposerDialog.submit` — insert a `plans` row (`status: "composing"`, `user_request: request`, `attached_document_ids: [activeDocId]`), then `supabase.functions.invoke("plan-compose", { plan_id })`. Show a toast ("Orby is planning your suggestion…"). The already-mounted `useComposingPlansWatcher` auto-approves, runs, and logs it.

## Notes / technical details

- No DB migration or new secret needed: suggestions are generated on demand and not persisted; plan creation reuses the existing `plans` table and `plan-compose`/`plan-step`/watcher pipeline.
- Placement: top-left orb is positioned with `env(safe-area-inset-top)` and a low z-index so it never covers existing overlays/dialogs or the bottom-left back buttons.
- Cost control: generation runs once per document open and is cached; re-runs only on manual refresh or switching documents (matches your choice).
- Reliability: tool-grounded prompt + the planner's own refusal path means a suggestion that can't be executed surfaces via the existing watcher's "Couldn't plan that — review" toast rather than failing silently.
