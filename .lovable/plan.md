# Media in the chat + every plan gets approved

Three changes: media shows up and stays "live" inside the chat, follow-up requests about a generated image/video keep working in that same conversation, and no plan ever runs until you approve it (optionally with notes).

## 1. See your media right in the chat

- Any image, video, or audio a plan creates in a chat appears under that plan's card as a real thumbnail/player — tap it to open it full-size in the media viewer, same as the gallery.
- Any media Orby or you mention by quoted title (`"Sunset over Austin"`) renders inline under that message too, so `"Attach Image titles"` picks now show what you picked.
- Still-generating items show a small "generating…" tile that turns into the finished image/video by itself while you watch the plan run. Failed ones say so.
- Videos and audio play inline with normal controls; nothing autoplays.

## 2. Keep talking about the media you just made

- Orby's chat and planning context now includes the media in this conversation: title, kind, when it was made, and the exact prompt it was made from.
- So "make the sky more orange and lose the text" continues from the last image without you naming it — it edits that asset in the gallery rather than starting from nothing.
- When it writes the new prompt it writes a complete, clean prompt (the original intent plus your change), never "same as before but…".
- Ambiguity is resolved to the newest matching item in that chat; if there is genuinely nothing to work from, Orby says so instead of guessing.

## 3. Nothing runs without your approval

Every plan — from the purple orb / Delegate, from a chat, from the AI Plans screen — stops at a review card and waits. The card shows what Orby detected, the capabilities it wants, and each step.

Four actions:

- **Approve** — runs it in the background as today.
- **Approve with notes** — opens a box (with the red dictation button). Orby rewrites the same plan with your changes and then starts it automatically, no second tap.
- **Add a note** — same rewrite, but the new plan comes back to you for review again. Repeatable.
- **Cancel** — drops it.

Only scheduled runs stay automatic (you already approved the schedule). Plans that fail or get stopped keep the existing "Tell Orby what to do" box.

## 4. Capability checkboxes

Already sticky per chat — multi-step planning, document editing, image/video generation, web search stay checked until you uncheck them. This will be verified end to end (send, switch chats, reopen the app) and fixed if it drifts.

## Technical notes

**Inline media**
- New `src/components/ChatMedia.tsx`: `<ChatMediaRow assets />` — image tile, `<video controls>`, `<audio controls>`, pending/failed states, URLs run through `src/lib/sb-proxy.ts` so they load on cellular; tap opens the existing media viewer route.
- New `src/hooks/use-chat-media.ts`: per thread, resolves media ids from `extractArtifacts()` (already in `src/lib/plan-memory.ts`) over the thread's plans, plus quoted titles parsed out of message text; one `media_assets` query keyed by thread, refetching on an interval while any plan in the thread is running so new assets appear as they finish.
- `ChatDialog.tsx` message renderer: attach the resolved row under plan cards and under text messages that quote a title.

**Media-aware context**
- `src/lib/assistant-context.server.ts`: add `buildMediaContext(supabase, { threadId, userId })` — recent thread media (plan artifacts) plus a small tail of the gallery: `id`, `title`, `kind`, `created_at`, `generation_params.prompt`, `status`. Capped and clipped like plan memory.
- Included by `chat-core.server.ts` (typed chat) and `realtime.functions.ts` (hands-free) so both see the same thing.
- `supabase/functions/plan-compose/index.ts`: same block injected into the composer prompt, plus rules — resolve unnamed references to the newest matching asset in this thread, prefer `regenerate_image`/`remix_images`/`video_to_video` over a fresh generation when the user is changing an existing asset, and always emit a complete standalone prompt.

**Approval for every plan**
- Migration: `alter table public.plans add column auto_approve_after_compose boolean not null default false;` (additive, default false, grants unchanged).
- `plan-compose`: auto-approve only when `schedule_id` is set (drop the `thread_id` condition) or when `auto_approve_after_compose` is true and steps exist — in that case it also kicks `plan-step` via `EdgeRuntime.waitUntil`.
- `src/hooks/use-composing-plans-watcher.ts`: remove the auto-approve branch entirely; every non-chat plan toasts "Plan ready — review it" and opens `PlanApprovalDialog`.
- `src/components/PlanReviewCard.tsx`: add the **Approve with notes** action — appends `\n\nNOTE FROM ME: <note>` to `user_request`, clears `steps`, sets `status = 'composing'` and `auto_approve_after_compose = true`, re-invokes `plan-compose`; card shows "Rewriting your plan, then starting it". **Add a note** keeps `auto_approve_after_compose = false`.
- `PlanApprovalDialog.tsx`: same notes affordance so plans reviewed outside a chat behave identically.

## Verification

Generate an image from a chat, confirm it renders inline and finishes live; reply "make it darker and remove the text" and confirm the plan targets that asset with a clean rewritten prompt. Long-press purple on a document: review card appears, Approve with notes rewrites then runs on its own; Add a note comes back for review; Cancel stops it. Check `/tmp/observability/build-errors.log` is clean.
