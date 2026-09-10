# Virtual Computer for Orby chats

One new toggle in chat settings: **🖥️ Virtual Computer**. When it's on, Orby can rent a temporary computer with a web browser in the cloud, do the job there, show you the screen live in the chat, tell you the result, and shut the machine down. Your own Mac and your own browser are never touched.

Everything else in the app stays exactly as it is. The toggle is off by default, like DaVinci Resolve Mode.

## What you'll see

1. You ask for something that needs a browser ("sign in to my library account and renew my books").
2. Orby writes its usual plan for you to review, with a virtual-computer step in it.
3. When that step runs, a card appears in the chat: **Virtual computer — working**, a short plain-language line for what it's doing right now, a **Watch live** button that opens the real screen, and a **Stop** button.
4. If it hits a password box, it pauses and asks you in the chat. You type the password into a one-time locked box (dots, not letters). It gets typed straight into the web page — it is never written into the chat and never shown to the AI.
5. Texted verification codes work the same way: it pauses, you paste the code, it continues in the same browser window.
6. Signed-in sites are remembered, so it only asks once per site.
7. When it's done, the answer (and any files it downloaded) land in the chat, and the machine is shut down immediately.

## Limits, so it can never run away

Balanced settings, enforced on our side, not left to the AI:

- About 8 minutes of wall clock per task, then it stops itself.
- A spend ceiling per task, passed to the service.
- 2 retries maximum; after that it reports plainly what blocked it.
- One virtual computer per person at a time.
- Every task ends with an explicit shutdown, including on failure, timeout, or when you press Stop. A sweeper also kills anything left running.
- Only sites relevant to the task are allowed; saved passwords are locked to the exact site they belong to.

## Cost control

- Uses **GPT 5.6 Luna** as the driving model (the cheapest capable option, and the service's own default).
- Machine time is billed by the minute, so the browser is started only when a step actually runs and stopped the second it finishes.
- Screen recording off; the live view is streamed only while you're watching.
- Cheap status polling, not heavy full-detail polling.

## Technical plan

### Service

Browser Use Cloud **API v4** — `https://api.browser-use.com/api/v4`, header `X-Browser-Use-API-Key`, your existing key stored as a server-side secret `BROWSER_USE_API_KEY` (requested via the secure secret form; never in code, never sent to the browser). Model `gpt-5.6-luna` (v4 default). Endpoints used: `POST /runs`, `GET /runs/{id}`, `GET /runs/{id}/status`, `GET /runs/{id}/events` (for `browser.ready` → `live_view_url`), `POST /sessions/{id}/queue` for follow-ups, `PATCH /browsers/{id} {action:"stop"}` and session stop for shutdown. Credentials use v4 `secretBindings` (`{alias, source:{type:"inline",value}, allowedDomains}`) so values are typed into the page server-side and never enter model context. Saved logins use `browserSettings.profileId`.

### Capability wiring (mirrors `davinci_resolve` exactly)

- `src/lib/chat-types.ts`: add `virtual_computer: z.boolean().default(false)` to `capabilitiesSchema`, `false` in `ALL_CAPS_ON`, add to `ACTION_GROUPS`, and to `normalizeCapabilities`.
- `src/components/ChatDialog.tsx`: add to `DEFAULT_CAPS`/`NO_CAPS`, a `CAP_LABELS` entry (`🖥️ Virtual Computer` / "Let Orby use a temporary cloud browser"), and to the client-side `ACTION_TOOL_GROUPS`. Sticky per thread via the existing `chat_threads.capabilities` write.
- `src/lib/chat-turn.server.ts`: add `virtual_computer` to `ACTION_TOOL_GROUPS` so it becomes an `allowed_tool_groups` entry for `plan-compose`.
- `src/lib/chat-core.server.ts`: add `virtual_computer` to the classifier's `KNOWN` list and merge logic, and append a "VIRTUAL COMPUTER MODE IS ON" section to the system prompt (what it can do, that it is a throwaway cloud machine, that it will ask for passwords/codes when needed, and that it never touches the user's own Mac).
- `supabase/functions/_shared/tools.ts`: one new tool `virtual_computer_task` in group `virtual_computer`, args: `task` (what to accomplish, written for a browser agent), `start_url` (optional), `allowed_domains` (optional), `needs_login` (boolean), `why`. `plan-compose/index.ts` gets a short guidance block, gated the same way the Resolve block is, telling the planner to use **one** step per browser objective and to keep objectives outcome-shaped.

### Execution (async, like the video jobs)

Edge invocations are short and a task runs minutes, so the step does not block:

1. New table `vc_runs` (`id, user_id, plan_id, step_index, thread_id, chat_message_id, provider_run_id, session_id, browser_id, live_view_url, status, phase_text, result, error, attempts, cost_usd, started_at, deadline_at, finished_at`), plus `vc_profiles` (one browser profile per user) and `vc_secrets` (per-user, per-domain, per-alias encrypted values). RLS on all three: owner-only select; writes through server code only; plus the required `GRANT`s.
2. `plan-step`'s `virtual_computer_task` handler: reserves the user's single slot, creates/reuses the profile, resolves any stored secrets for the target domains into `secretBindings`, calls `POST /runs`, inserts a `vc_runs` row and a `chat_messages` row of new kind `vc`, then leaves the step in `awaiting_external` and returns.
3. New `src/routes/api/public/vc-tick.ts`, driven from the existing minute scheduler alongside the chat-turn and plan ticks, plus a faster client-side nudge while a card is visible. Each tick: poll status, refresh `live_view_url` and the plain-language phase line, enforce the deadline and retry count, and on completion write the result into the plan step, flip the plan back to `running` so the plan continues, and stop the browser and session.
4. A watchdog pass in the same tick stops any run past its deadline or orphaned by a lost plan.

### Live view and progress in chat

- New `chat_messages.kind = "vc"` rendered by a `VirtualComputerCard` in `ChatDialog.tsx` (same place `kind: "plan"` is special-cased): status chip, phase line, **Watch live** (opens the live view in a full-screen sheet inside the chat, iframe on desktop, new tab on iPhone), **Stop**, and the final result. Polls `vc_runs` every 2s while active, like `PlanProgressCard`.
- Stop marks the row `canceled`, stops the run and browser, and fails the plan step cleanly with no error bubble.

### Passwords, codes, saved logins

- When a run needs a credential it doesn't have, the tick pauses it and posts a `vc_secret_request` chat message. The card shows a masked one-time field (no autofill, no clipboard echo) and never renders the value again.
- A new authenticated server function takes that value, encrypts it, stores it in `vc_secrets` scoped to `{domain, alias}`, and resumes the run: for a password, a fresh run on the same `session_id` with the new `secretBindings`; for a one-time code, the same, with a single-use alias that is deleted right after.
- Values are never written to `chat_messages`, never put in a plan step's args or result, never logged, and never sent to any model. Live-view URLs are treated as credentials: short-lived, owner-only, never in a public message.
- "Remember the login" = the per-user browser profile keeps the site's signed-in state, so later tasks skip the prompt. Chat settings gets **Forget saved logins**, which deletes the profile and all stored secrets.

### Guardrails

- Server-owned caps: wall clock, `maxCostUsd`, retries, single concurrent run, domain allowlist per secret.
- No MCP bridge involvement at all — this path cannot reach the user's Mac or DaVinci Resolve.
- Ownership checks on every read/write, matching the isolation work already done for chats and plans.

### Verification before I call it done

Typecheck and build; a real end-to-end run on a public site (open a page, extract a fact, return it to chat) confirming the live view appears, the result posts, and the browser is stopped; a deliberate timeout run confirming self-shutdown; and a login run confirming the masked prompt path stores nothing in the chat.
