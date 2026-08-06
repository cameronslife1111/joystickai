# Connect chat conversations to plans

Right now a plain-text chat and a plan feel like two separate things: when you tick planning / document editing / image generation mid-conversation, the next message is judged mostly on its own words, and the planner only sees a thin slice of the chat (about 10 turns, each cut at 400 characters). This makes Orby forget the conversation that led up to the request.

Goal: ticking a capability is treated as "act on what we've been talking about", and the whole recent conversation becomes the brief for the plan.

## What changes

1. **Ticking a capability counts as intent.** When you check planning, document editing, image generation, video generation or scheduling for a message, that message is routed to a plan unless it is clearly just a question about something ("what do you think of…", "how does…"). Today the router demands an explicit imperative like "rewrite this doc", so mid-conversation follow-ups such as "ok do it" or "make those" fall back to a text reply.

2. **The attached-document override stops blocking it.** The current safety net forces a text reply when documents are attached and the message has no action verb. That override no longer applies when you deliberately ticked an action capability for that message.

3. **The conversation becomes the plan's brief.** When a plan is created from a chat, the planner receives a much richer transcript of that thread (roughly the last 30 turns, with far more text per turn instead of 400 characters), clearly labelled as the conversation the request continues. It is passed alongside the request itself, not just buried in background context, with an instruction to read the request as the latest turn of that conversation and pull the concrete details (titles, counts, styles, decisions already agreed) from earlier turns.

4. **Short follow-ups get resolved, not guessed.** The planner is told explicitly that a brief message like "do it", "make those", "yes go ahead" means: carry out what the conversation just agreed on, using the ids and titles already in context — and never to invent new goals the conversation did not ask for.

5. **Attached documents stay in play.** Documents attached to the thread continue to be handed to the plan as targets, so a conversation about a specific document still edits that document.

## What does not change

- Nothing checked still means a plain-text reply.
- Capability checkboxes stay one-shot (they clear after each send).
- Plan approval, stop, check-ins and the "fresh plan isolation" rules stay exactly as they are — the conversation is shared, but other plans' internal steps still are not.
- Hands-free calls stay text-only.

## Technical notes

- `src/lib/chat.functions.ts`: pass an "explicit action capabilities were just enabled for this message" signal into `classifyRoute`, add router rules that bias toward `plan` in that case (still allowing `chat` for pure questions), and skip the attached-document `wantsAction` override when those capabilities are on.
- `supabase/functions/plan-compose/index.ts`: widen the `chat_messages` continuity fetch (limit 10 → ~30, per-message cut 400 → ~2000 chars, with an overall size cap), and pass the transcript into the planner's user message as a `CONVERSATION SO FAR` block above the current request, plus wording that tells the planner to treat the request as the latest turn and resolve short follow-ups from it.
- No schema change and no new tables; scheduled plans are unaffected because they carry no `thread_id`.
