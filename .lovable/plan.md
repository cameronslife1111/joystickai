# Switch Orby's thinking to gpt-5.6-luna

Move every text/reasoning call from `gpt-5.6-sol` to the cheaper `gpt-5.6-luna`, including the brain behind the phone call.

## What changes

- Chats: replies, routing (answer vs. plan), chat titles, and the sentence/document helpers all run on Luna.
- Planning: writing plans, running each step, and retrying failed plans all run on Luna.
- Phone call: the voice you talk to stays the same live voice model (it is the only one that can listen and speak in real time). Everything it actually thinks or does is already handed back to Orby's own chat runner, so that work now runs on Luna too — including anything you ask it to plan.
- Media prompt rewrites (image/video "redo") run on Luna.

## What stays the same

- Voice typing keeps its transcription model.
- Image, video and avatar generation keep their current providers.
- Call context: when you hang up, the conversation is already saved into the chat, so asking for a plan afterwards keeps everything that was said.

## Technical detail

Replace the `"gpt-5.6-sol"` model id with `"gpt-5.6-luna"` in:

- `src/lib/chat-core.server.ts` (router/answer model)
- `src/lib/chat.functions.ts` (thread titles)
- `src/lib/ai.functions.ts` (4 call sites)
- `src/lib/delegate.functions.ts` (live-call delegation)
- `src/lib/orby-call-docs.functions.ts` (`getModel`)
- `src/lib/media-revise.functions.ts`
- `supabase/functions/plan-compose/index.ts`, `plan-step/index.ts` (2 defaults + 1 inline), `plan-retry/index.ts` — the `PLANNER_MODEL` fallback, keeping the env override

`src/lib/live.functions.ts` keeps `LIVE_MODEL = "gpt-live-1"` with `delegation: { type: "client" }`, so the call's reasoning flows through the Luna path.

Redeploy the three plan edge functions after the change.
