# Switch Orby's thinking from gpt-5.6-luna to gpt-6-luna

Every place that uses Luna moves to the new `gpt-6-luna`. Nothing else changes: prompts, voice call model, transcription, image/video providers all stay the same.

## What changes

- Chats: replies, routing, chat titles, sentence/document helpers
- Planning: writing plans, running steps, retrying plans (the optional override setting still works)
- Fast virtual computer strategy, call document helpers, delegate analysis, media prompt rewrites

## Technical detail

Replace `"gpt-5.6-luna"` with `"gpt-6-luna"` in 14 spots:

- `src/lib/ai.functions.ts` (lines 41, 81, 133, 226)
- `src/lib/chat-core.server.ts:426`, `src/lib/chat.functions.ts:56`
- `src/lib/delegate.functions.ts:70`, `src/lib/orby-call-docs.functions.ts:11`
- `src/lib/media-revise.functions.ts:27`, `src/lib/vc-reflex.server.ts:85`
- `supabase/functions/plan-step/index.ts` (62, 1309, 2228), `plan-retry/index.ts:9`, `plan-compose/index.ts:10`

Redeploy the three plan functions.

## Verification

Build check, then one real chat message on your OpenAI key. If OpenAI rejects the `gpt-6-luna` id (for example, a different exact name or parameters it doesn't accept), I'll report the exact error and fix it rather than silently falling back to 5.6.
