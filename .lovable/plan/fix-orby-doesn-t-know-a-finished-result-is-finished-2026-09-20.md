# Fix: Orby doesn't know a finished result is finished

## What's wrong (confirmed in the code)

During a hands-free call, when Orby hands work to her own backend, the result appears in the chat but the voice side is never told the work finished:

1. When the work starts, the call tells the voice model: "Nothing is finished yet — report the outcome only when a result arrives." That message is tagged with the delegation id (`src/lib/hands-free.tsx`, `runDelegated`).
2. When the result lands, the watcher hands it over **without** the delegation id (`voiceRef.current.appendCommentary(...)` with no id). So from the voice model's point of view the job it was told about is still open — it keeps saying it's waiting or working.
3. Some outcomes post nothing into the chat at all (an answer that continues a paused plan returns `resumed` and inserts no message), so the call never gets any completion signal.
4. The history sent with the delegated request comes from the browser's cached message list (`qc.getQueryData(["chat_messages", tid])`). If that chat was never opened, or the cache is stale, Orby runs the request with partial or empty history.
5. `pendingTurnRef` is cleared as soon as the job is *queued*, not when it *finishes*, and nothing remembers which delegation ids were already handled — two quick delegation events can queue the same spoken request twice.
6. The message writer and the delegation runner read `threadIdRef.current` at the moment they run, so a chat switch mid-flight can land a message or a result in the wrong chat.

## The fix

**Completion is signalled, not guessed.** After queueing a turn, the call watches that exact `chat_turns` row until it reaches `done`, `failed` or `canceled`. On completion it sends one silent update tagged with the same delegation id, stating plainly that the job finished and what the outcome was (the assistant text that was saved, the plan kickoff, or "the answer was passed to a running plan"). Pending state is cleared at that moment, not before. A failed turn gets an equivalent tagged failure note so Orby can say so instead of hanging.

**Results are tagged.** The existing result watcher passes the delegation id of the job that is still open, so a result can never read as "still waiting". Results with no open job keep today's untagged behaviour.

**Persisted history is the source of truth.** The delegated turn's history is read from `chat_messages` for that thread (newest 20, same shape as the typed-chat path) instead of the React Query cache, right before the turn is queued.

**Isolation and no duplicates.** Every delegated job captures its conversation id, message id and delegation id once and uses those captured values for the whole lifecycle — completion watch, tagged updates, cache writes — so switching chats mid-request cannot move anything. Handled delegation ids are remembered for the call, and the queued turn id is stored, so a repeated delegation callback is ignored instead of queueing a second turn or writing a second message. Ending the call clears all of it.

**Logging.** Structured one-line logs at queue, completion, and each tagged update: conversation id, message id, delegation id, turn id, status, whether a result was persisted, and the number/roles of history messages sent. No text of secrets, no keys, no tokens.

No arbitrary delays are added, streaming transcript behaviour and the visible chat UI stay exactly as they are.

## Technical notes

- `src/lib/hands-free.tsx`
  - `runDelegated`: capture `tid`/`uid`/`delegationId`; dedupe via a `handledDelegationsRef` set; read history from `chat_messages` via Supabase instead of `qc.getQueryData`; keep `pendingTurnRef` (plus a `pendingJobRef` holding `{ delegationId, turnId, threadId }`) set until completion.
  - New completion watcher effect: polls the pending job's `chat_turns` row (status, error, `payload.assistantMessageId`, `payload.route`); on terminal status emits `appendThinking(...)`/`appendCommentary(...)` with the delegation id and clears the job.
  - Result watcher: pass `pendingJobRef.current?.delegationId ?? null` into `appendCommentary`; guard every write with the captured thread id.
  - `stop`/`start`: reset `pendingJobRef`, `handledDelegationsRef`.
- `src/lib/chat-turn.server.ts`: already writes `assistantMessageId` and `route` into the finished payload; add the structured completion log there (turn id, thread id, user id, route, assistant message id, outcome).
- Tests in `tests/`: a unit test for the delegation lifecycle reducer/helpers — completion tagging uses the originating delegation id, a duplicate delegation callback is a no-op, a `resumed` outcome still produces a completion signal, and a job captured for chat A is not affected by a switch to chat B. Manual pass: start work in chat A by voice, let it finish, send a follow-up in chat A and confirm Orby references the finished result; then switch to chat B mid-request and confirm the request, result and pending state stay in chat A.
