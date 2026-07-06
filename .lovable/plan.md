# Port Orby to a threaded, agentic Chat (remove Call mode)

## Goal
Delete the live voice call mode entirely and make **Chat** the single home for everything Orby can do. Chat gets: multiple threads (create / rename / clear / delete), per-thread attached documents that persist, grouped capability toggles, and inline **auto-running multi-step plans** (Etik-style) with visible progress. Long-pressing the orb opens the most recent chat thread instead of the plan composer.

## Decisions locked
- Plans **auto-run** and stream step progress inline (no approval tap).
- Toggles are **6 grouped categories**, not per-tool.
- Live call code is **deleted**; the document-editing capabilities are kept and reused inside chat.
- Thread list lives in a **slide-in drawer inside the chat dialog**.

---

## 1. Database (migrations)

**New `chat_threads`**
- `id, user_id, title, attached_document_ids text[] default '{}', capabilities jsonb, created_at, updated_at`.
- `capabilities` default = all six groups on: `web_search, image_analysis, planning, image_generation, video_generation, document_editing`.
- Full `GRANT` block + RLS scoped to `auth.uid()`; `touch_updated_at` trigger.

**Alter `chat_messages`**
- Add `thread_id uuid` (FK → chat_threads, on delete cascade), `plan_id uuid null`, `kind text default 'text'` (`text` | `plan`).
- Backfill: create one "Chat" thread per existing user, assign their existing messages to it, then make `thread_id` not null.
- Update RLS/policies to keep user scoping.

**Alter `plans`**
- Add `thread_id uuid null` so an auto-run plan can post progress back to its thread.

## 2. Capability groups → tool mapping
One toggle per group, stored in `chat_threads.capabilities`:
- **Web search** → Perplexity route.
- **Image analysis** → vision route.
- **Planning / multi-step** → allows plan composition + `expand_plan`.
- **Image generation** → `generate_image, regenerate_image, remix_images`.
- **Video generation** → `image_to_video, video_to_video, audio_image_to_video`.
- **Document editing** → `create_document, rename_document, add_sentence, update_sentence_content, move_sentence, link_sentence_to_document, mark_*_for_deletion, rename_media, read/find_* , generate_text`.
Disabled groups are filtered out of the tool catalog before planning.

## 3. Backend

**`src/lib/chat-threads.functions.ts`** (new, `requireSupabaseAuth`): create, rename, delete, clear-messages, set-attached-docs, set-capabilities.

**Rework `src/lib/chat.functions.ts` `sendChatMessage`**
- Accept `threadId`; load thread's `attached_document_ids` + `capabilities`.
- Route the message:
  1. Pure conversation / web search / image analysis → answer directly (as today), scoped to the thread's messages.
  2. Action intent (edit docs, make images/video, multi-step task) and the matching group is enabled → **compose a plan** via the existing `plan-compose` edge function, passing the thread's attached docs and the filtered tool catalog, set `plan.thread_id`, mark it approved so it **auto-runs**.
- Return either `{ text }` or `{ planId }`.

**Reuse existing plan pipeline** (`plan-compose`, `plan-step`, `use-running-plans-advancer`): extend to persist/read `thread_id` and to accept an allowed-tool-group list so disabled capabilities are excluded. Progress already advances via the running-plans advancer.

## 4. Frontend — `ChatDialog.tsx`
- **Thread drawer** (slide-in): list threads, New thread, and per-row rename / clear / delete (no nested buttons — separate controls). Active thread highlighted; selecting switches the message query.
- Messages, attached docs, and capability toggles all key off the **active thread id**; attached docs and toggles are persisted to `chat_threads` (not local state).
- Settings popover → six grouped capability switches.
- Render `kind: 'plan'` messages as an inline **progress card** reusing `StepReasoning` / existing plan step UI, live-updating from the `plans` row.
- Keep the current visual style (same dialog, composer, bubbles).

## 5. `app.tsx` wiring
- Long-press orb → open ChatDialog on the **most recent thread** (creating one if none). Remove `onLongPressStart` opening `PlanComposerDialog`.
- Remove all call-mode usage: `useCallMode`, `startCall`, `inCall`, minimized-overlay branch, `orb-call` styling hook, and the `CallOverlay` render.
- Remove `CallModeProvider` from the app tree.
- Keep `AIPlansScreen` as a read-only history/monitor of plan runs.

## 6. Deletions
- `src/components/CallOverlay.tsx`
- `src/contexts/CallModeContext.tsx`
- `src/lib/orby-realtime.functions.ts`, `orby-stt.functions.ts`, `orby-call-intent.functions.ts`
- `src/lib/orby-call.functions.ts` (move its Perplexity web-search helper into `chat.functions.ts` if not already duplicated)
- `PlanComposerDialog.tsx` (superseded by chat) and its long-press entry
- `call-phrases.ts` if only used by call mode
- **Keep** `orby-call-docs.functions.ts` (doc-editing server fns) — reused by chat/plan tools.

## Technical notes
- All new tables get GRANTs in the same migration (authenticated + service_role; no anon).
- New server functions use `requireSupabaseAuth`; bearer middleware in `src/start.ts` already attaches the token.
- Chat stays a `createServerFn` call; plan execution reuses the existing edge functions and advancer, so no new streaming endpoint is required.
- Verify: create 2 threads, attach a doc to each, send messages, reload → each thread restores its own messages, docs, and toggles; trigger an image-generation request and confirm the plan auto-runs with inline progress and the asset lands in the gallery.

This is a large change; I'll implement it in stages (DB → backend → chat UI → app wiring → deletions) and verify after each.
