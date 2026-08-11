# Include the chat thread in web searches

Right now, when you tick web search in a chat, Orby only sends the single message you just typed (plus any attached documents) to the search. Everything you and Orby said earlier in that thread is dropped, so follow-ups like "what about prices for that one?" lose the subject.

## What changes

- A web search request now carries the recent conversation from that thread as context, so short follow-ups are understood in light of what was already discussed.
- Orby first turns the conversation plus your latest message into a single, self-contained search question (resolving "that", "those", "it" into the actual names), and searches with that.
- The answer still comes back as plain text in the same thread, and attached documents are still passed along as reference.
- Nothing changes when web search is off, and hands-free calls are unaffected.

## Technical notes

- `src/lib/chat.functions.ts`: `runWebSearch` currently receives only `latestWithDocs`. Change the web route to:
  1. Build a transcript of the last ~12 turns (already computed as `recent` for the router) and reuse it.
  2. Pass `recent` into the Perplexity call as prior conversation turns (a `CONVERSATION SO FAR` block before the current question), keeping the existing plain-text system prompt.
  3. Before searching, resolve pronouns/ellipsis into a standalone query using the existing gateway model (one short call), falling back to the raw message if that fails.
- Keep an overall size cap on the transcript so long threads don't blow up the request.
- No schema change, no new files, no UI change.
