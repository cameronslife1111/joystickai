# Chats open at the bottom + per-chat "Auto approve plans"

## 1. Chats truly scroll to the bottom

Opening a chat (or switching threads) currently lands part-way down, worst after a multi-step plan finished, because the scroll happens on one animation frame — before plan cards, media thumbnails and long replies have their real height, so the container grows after the scroll already ran.

Fix:
- On open / thread switch, jump instantly (no smooth animation) to the bottom, then keep re-pinning to the bottom for a short settle window as content lays out.
- Watch the message list for size changes (images, videos, plan cards expanding, a plan finishing) and re-pin to the bottom whenever the user is already at/near the bottom — never yank them down if they've scrolled up to read.
- New messages and streaming plan updates keep the existing smooth auto-scroll behaviour.

## 2. "Auto approve plans" option in the chat settings

A third checkbox under **Planning / multi-step** and **Document editing**:

- Label: "Auto approve plans", hint: "Run plans in this chat without asking me first".
- Sticky per chat, exactly like the other two: checked stays checked until unchecked, saved on the thread, restored when reopening the chat.
- When it's on, a plan created in that chat skips the review card and starts running as soon as it's written; the chat still shows the plan card with live progress.
- When it's off, nothing changes — every plan waits for Approve / Approve with notes / Cancel.
- Only affects the chat it was checked in. Other chats, the purple orb Delegate flow outside that chat, and the AI Plans screen still require approval.

## Technical notes

- Migration: `alter table public.chat_threads add column auto_approve_plans boolean not null default false;` (additive, grants/RLS unchanged).
- `ChatDialog.tsx`: extend the `Thread` type and the thread `select` lists with `auto_approve_plans`; new state mirrors the capability-checkbox pattern (optimistic `qc.setQueryData` + `chat_threads` update through the existing `updateThread`).
- Plan creation in `handleSend` (route `"plan"`): when the thread flag is on, insert the plan with `auto_approve_after_compose: true`. `supabase/functions/plan-compose/index.ts` already approves and kicks `plan-step` for that flag, so no edge-function change is needed; `review_in_chat` stays true so the card renders progress.
- Scroll: replace the single `requestAnimationFrame` bottom-scroll with an `open`/`activeThreadId`-keyed effect that scrolls with `behavior: "auto"` on a few successive frames/timeouts, plus a `ResizeObserver` on the messages wrapper that re-pins when `scrollHeight - scrollTop - clientHeight` is within a small threshold.

## Verification

Open a chat whose last item is a completed multi-step plan with media — it lands at the very bottom. Scroll up mid-thread and confirm new content doesn't yank the view. Check "Auto approve plans", send a request that becomes a plan, confirm it runs without a review card; uncheck it and confirm the review card returns; reopen the app and confirm the checkbox state persisted per chat.
