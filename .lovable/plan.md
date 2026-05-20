## Attach documents to a Plan

Add a doc picker below the textarea in the Plan composer so the user can attach up to 10 documents that get sent to the planner alongside (or instead of) their typed request. The planner force-inlines those docs into its workspace snapshot, so the plan is grounded in their real content rather than relying on token-overlap guesses.

### Behavior (UI)

`PlanComposerDialog.tsx`:

- Below the textarea, add a collapsible "Attach documents" section:
  - Trigger row: button labeled `+ Attach documents` showing a count chip when any are selected (e.g. `Attached (3)`).
  - When opened, render a search `Input` and a scrollable list (max-height ~14rem) of the user's documents, sorted via `sortDocsByTitle`, each row a checkbox + title + sentence count.
  - Live-filter the list by case-insensitive substring against title.
  - Hard cap: **10 attachments**. Once 10 are selected, unchecked rows are disabled and a hint reads "Maximum 10 documents".
  - Selected docs also render as removable chips directly under the section header so the user sees their picks without scrolling.
- Submit button (`Generate Plan`):
  - Enabled when `text.trim()` is non-empty **OR** `attachedDocIds.length > 0` (user no longer has to type if they've attached docs).
  - Disabled state otherwise.
- Suggestion chips: keep as-is.
- Data fetch: reuse the `documents_with_counts` query pattern from `DocumentPickerSheet` (one query inside the dialog, `enabled: open`). No new shared helper — copy the small fetch inline to avoid coupling the picker UI changes to the sheet's layout.

### Behavior (data flow)

When the user submits with attachments:

1. Insert the `plans` row with the new field `attached_document_ids: string[]` populated alongside `user_request`.
2. Invoke `plan-compose` exactly as today (`{ body: { plan_id } }`). The function reads the attached ids off the row.
3. If `user_request` is empty but attachments are present, store a placeholder request like `"(no instructions — see attached documents)"` so the planner still sees a coherent prompt. The user-visible "user_request" copy in `AIPlansScreen` / `PlanApprovalDialog` will then list attachment titles, see below.

Optional UX touch in `AIPlansScreen` row subtitle: when `attached_document_ids` is non-empty and `user_request` is the placeholder, show `Attached: <Title A>, <Title B>` instead of the placeholder text. Out of scope if it adds churn — leave the placeholder visible.

### Server change (`supabase/functions/plan-compose/index.ts`)

- After loading the `plan` row, read `plan.attached_document_ids` (uuid[]).
- Build a `forcedDocIds` Set from that list.
- In the existing snapshot logic:
  - Union `forcedDocIds` into the `docsToInline` list so they ALWAYS get full-text inlined regardless of token score (token-relevance still chooses the rest, capped at 6; forced docs are inlined in addition to that cap or replace the cap entirely — pick "in addition, but never duplicate", so up to 6 + N_attached docs are inlined).
  - Re-fetch sentences for any forced id not already in the score-derived inline set.
- Augment the snapshot intro so the planner is told these are explicit attachments:
  - Add an extra section `ATTACHED DOCUMENTS (the user explicitly attached these to the request — treat their content as primary input even if the request text is short):` listing `id — title` for each attachment, before the `REFERENCED DOCUMENTS` block.
- Update the planner system prompt with one bullet:
  - "If ATTACHED DOCUMENTS are present, treat their contents as primary context for resolving the request. Prefer using their text and ids directly over calling find_* tools."

No change to `plan-step` — attachments only affect composition.

### Schema change

Add nullable `uuid[]` column to `plans`:

```sql
ALTER TABLE public.plans
  ADD COLUMN attached_document_ids uuid[] NOT NULL DEFAULT '{}';
```

No RLS change needed (existing `own plans *` policies cover all columns). No index needed — the column is read only when fetching the single plan row by id.

### First-principles edges considered

- **Empty request + attachments**: allowed; planner gets the placeholder string and the attached docs in the snapshot. Without attachments AND without text, submit stays disabled.
- **Attached doc deleted between attach and compose**: snapshot fetch returns no sentences; forced section simply omits that id. Planner still sees the rest. No crash.
- **User attaches the same doc the planner would have inlined anyway**: dedupe by id; the doc appears once under ATTACHED DOCUMENTS (preferred) and is removed from the score-derived inline set.
- **Token budget**: existing per-doc 8KB cap stays. With up to 10 forced docs that's ~80KB in worst case — large but within OpenAI context. If this becomes a problem later, drop the per-doc cap to ~4KB when attachments > 5. Out of scope for this change.
- **Privacy / isolation**: attached_document_ids must belong to the requesting user. Enforced by the existing user-scoped fetch in plan-compose (`.eq("user_id", user.id)` on `sentences`); ids that don't belong to the user return zero sentences.
- **Re-running compose**: if a plan ever re-composes (currently it doesn't), the attached list persists with the row so the same context is rebuilt.
- **`origin_document_id` prop**: still passed but unused server-side per the "plan independence" rule. Leave the prop signature alone to avoid churn in `app.tsx`.

### Files touched

- `src/components/PlanComposerDialog.tsx` — UI for picker + chips + submit gating + insert row with `attached_document_ids`.
- `supabase/functions/plan-compose/index.ts` — read column, force-inline, extend system prompt.
- Migration adding `attached_document_ids uuid[]` to `plans`.

### Out of scope

- Attaching media assets (could be a follow-up — would need its own picker).
- Showing attachment titles on the AIPlansScreen row.
- Letting the user attach a doc range or specific sentences.
- Changing the planner model or tool catalog.
