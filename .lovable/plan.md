# Swap gpt-5.6-sol to gpt-5.6-terra

Keep all chat behavior identical — only the model id changes to the cheaper Terra model.

## Changes

- `src/lib/chat.functions.ts` (2 spots): chat reply model and the second call site both switch from `gpt-5.6-sol` to `gpt-5.6-terra`.
- `supabase/functions/plan-step/index.ts` (1 spot): the fallback model default changes from `gpt-5.6-sol` to `gpt-5.6-terra`.

Nothing else changes: prompts, plain-text rules, tools, streaming, context building, and all other models (the `gpt-5.5` call sites) stay exactly as they are.

## Verification

Typecheck, then send one chat message to confirm a normal reply comes back on the new model.
