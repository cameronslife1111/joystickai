# Fix the stuck chat + rewrite plans in Go To Format

Two things: stop the chat and the plan cards from spinning forever, and change every plan Orby writes into the Go To Format so there is zero room for misunderstanding.

## What I found (confirmed in the live data)

- Your plans actually finish. The last several ran and completed within seconds of approval — but the card on screen never learns that. The card stops checking the plan the moment it is "waiting for review", so after you tap Approve the button spins forever even though the work already ran in the background. Reopening the chat shows it finished.
- Nothing is stuck in the queue server-side either. Every past message was answered. The "stuck thinking" spinner is the same class of problem: the dots are driven by a local flag that is only cleared when the app itself notices the answer land. If the app misses that moment (screen locked, chat closed and reopened, a dropped nudge), the dots stay forever with no timeout and no way out.
- The safety net that finishes abandoned messages is never being run on a schedule. Plans have a background heartbeat every 10 seconds; chat messages have none, so a message whose first nudge fails only gets picked up if you happen to switch away and back.
- Today's plan wording is literally instructed to say "Orby will use <capability> to ..." — that is where the vague "Orby will use the chat to complete the goal" lines come from.

## 1. Nothing spins forever

- After Approve, the card immediately flips to "Working…" and keeps checking the plan until it is genuinely finished, cancelled or failed. Approve, Add a note and Cancel all release their spinner (and show a real error if the write failed).
- The plan card keeps refreshing while a plan is waiting for review, so an approval from anywhere (this card, a toast, another device) is reflected within a couple of seconds.
- The thinking dots get a real source of truth: they are reconciled against the queued-message list, so if the server says nothing is running in that chat, the dots stop. If a message has been queued for over ~25 seconds without progress, the app pokes the finisher itself, and after a hard timeout the chat shows "That message didn't come back — tap to retry" instead of thinking forever.
- A plan stuck on "Planning…" for more than ~90 seconds shows a "Retry planning" button in its card rather than an endless spinner.
- The abandoned-message finisher gets a heartbeat every 20 seconds, the same way plans already do, so replies land even with the app closed.

## 2. Plans are written in Go To Format

Every plan Orby proposes will read exactly like this:

```text
🏆 Let's build the morning routine.

Go to the Morning Routine document and add the intro sentence.

Go to the Media Gallery and generate the sunrise image.

Special note: keep the original photo untouched.
```

Rules enforced, not just requested:

- First line is always `🏆 Let's [4–5 words describing the overall task].`
- Every step is one sentence: `Go to the X and Y.` — X names the real destination (the document title, the Media Gallery, this chat, the timeline in DaVinci Resolve), Y is what happens there in fewer than 7 words.
- Longer actions get split into separate baby steps instead of one long sentence.
- Your own wording is preserved — the destination and the action use your words, not paraphrases.
- Special notes stay as plain sentences in the position they belong to, not forced into Go To shape.
- Plain text only: no numbering, no bullets, no bold, no markdown.

If Orby returns a step that breaks the format, the planner rewrites that line into Go To shape from the step's own destination and action before you ever see it, so vague lines can't reach the card. Refusals still say plainly why it can't be done.

The review card and the progress card both show the trophy line on top and the Go To sentences underneath as plain lines (no "1. 2. 3."), with the ticks/spinner beside each one while it runs.

## Technical notes

**Stuck-state fixes**
- `src/components/ChatDialog.tsx`: split `PLAN_DONE` into `PLAN_TERMINAL` (`completed | failed | cancelled`) used for the poll-stop and `isRunning`; `proposed` no longer stops `refetchInterval`. Add a `composing` age check → "Retry planning" button that re-invokes `plan-compose`.
- `src/components/PlanReviewCard.tsx`: `approve()` optimistically patches `["chat_plan", plan.id]` to `approved`, invalidates `plans` queries, and clears `busy` in a `finally`; same for `sendNote` and `cancel`.
- `src/components/ChatDialog.tsx` turn tracking: reconcile `busyThreadIds` against the fetched `chat_turns` rows (drop any thread with no `pending`/`running` row after a short grace), record a per-thread queue timestamp, self-nudge `/api/public/chat-turn-tick` when a turn exceeds ~25s, and surface a retry affordance past a hard timeout. Also treat `failed`/`canceled` turn rows as idle.
- New migration: pg_cron job `orby-chat-turn-tick`, every 20 seconds, `net.http_post` to `https://orbyai.lovable.app/api/public/chat-turn-tick` with the anon key header (mirrors `orby-plan-tick`).

**Go To Format**
- `supabase/functions/plan-compose/index.ts`: replace the WORDING CONTRACT block with the Go To Format spec (trophy summary line, `Go to the X and Y.`, Y < 7 words, baby steps, exact wording preservation, special notes, plain text). `summary` becomes the trophy line only; `notes` (optional string array) carries special notes.
- Post-validation in the same file: normalize `summary` to start with `🏆 Let's ` and 4–6 words; for each step, require `description` to match `/^Go to .+ and .+\.$/` with the `and` clause under 7 words, otherwise deterministically rebuild it from `io.destination` + `io.operation` (truncated to 6 words) as `Go to the <destination> and <operation>.`; strip markdown characters. `io` contract and all existing target/deletion guards stay unchanged.
- `plan_summary` stored as the trophy line plus any special notes (no more "Orby will use …" explanation block).
- `src/components/PlanReviewCard.tsx` and `PlanProgressCard`: render the trophy line as the heading, steps as unnumbered plain lines.

**Verification**
Send a planning request in a chat, approve it, and watch the card go straight to Working → Done without a refresh; send a plain message and confirm the dots stop; check a composed plan reads as a trophy line plus Go To sentences; run `bunx tsgo --noEmit` and check the build log.
