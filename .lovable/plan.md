# DaVinci Resolve Mode for Orby chat (and a slot for other creative apps)

## What the research says

DaVinci Resolve is scripted through Blackmagic's own Python/Lua API, which only works
on the same computer where Resolve Studio is running (it talks to the app through a
local scripting module, and Studio — not free Resolve — is required for it).
The community MCP servers for Resolve are all wrappers around that same local API:
samuelgursky/davinci-resolve-mcp (the most established one), jenkinsm13/resolve-mcp
(~295 tools, tracks API v20.3), and CiprianSpiridon/davinci-resolve-mcp (~334 tools).
They are designed to be launched on the user's own machine by a desktop AI client.

The consequence that shapes this feature: Orby runs in the cloud, so it cannot reach
Resolve on the user's computer by itself. Something has to run on that computer once.
So the setup flow is a small "Orby Bridge" the user installs once: it starts the
Resolve MCP server locally and keeps a connection open to Orby. Nothing about Resolve
is reachable without that step — no cloud-only path exists.

## What you get

- A **DaVinci Resolve Mode** toggle in the chat toggles list, sitting with
  Planning / Document editing / etc., with the same look and the same sticky
  per-thread memory.
- Turning it on the first time opens a short setup card: connect your computer with a
  one-time pairing code, confirm Resolve Studio is open, and Orby shows a green
  "Connected — Resolve 20.x, project: …" status.
- After that, the connection is remembered. Turning the toggle on in any later chat
  just shows the status; no re-setup.
- You then talk normally. "Pull the green screen off the clip on track 2, key it over
  the beach plate, then export a 9:16 short" becomes a multi-step plan the same way
  today's plans work — each step is one Resolve command, with the same review/approve,
  progress, stop and retry behaviour you already have.
- If Resolve isn't reachable when a step runs, the step waits and Orby tells you in the
  chat instead of failing silently.

## Modular by design

Nothing in this is Resolve-specific except one file. The toggle, the connection status
pill, the setup card, and the plan step runner all work off a generic "external tool
connection" record with a provider name. Adding Photoshop, Blender or VS Code later
means adding one provider entry (name, icon, MCP server command, hints) — no changes to
the chat UI, the planner, or the setup flow.

## Technical detail

**Data**
- `mcp_connections` — one row per user per provider: `provider` ('davinci_resolve'),
  `status` (pending | connected | offline), `pairing_code`, `token_hash`,
  `last_seen_at`, `server_info` (jsonb: version, tool list, current project).
  RLS: owner-only select/insert/update/delete, plus GRANTs for `authenticated` and
  `service_role`.
- `mcp_commands` — the work queue: `connection_id`, `tool_name`, `arguments`, `status`
  (queued | running | done | error), `result`, `error`. Same owner-only RLS.
- `capabilities` on chat threads gains `davinci_resolve` (default false) via the
  existing `capabilitiesSchema`.

**Bridge protocol** (routes under `src/routes/api/public/mcp-bridge/*`, caller verified
by the bridge token — the `/api/public` prefix does not authenticate anything):
- `POST /pair` — exchanges a pairing code for a long-lived bridge token, marks the
  connection `connected`, stores `server_info`.
- `POST /poll` — long-poll: returns the next `queued` command for that connection and
  marks it `running`; also refreshes `last_seen_at`.
- `POST /result` — bridge posts the MCP tool result or error back.
The bridge itself is a published npx-style helper (`orby-bridge`) that spawns the
chosen Resolve MCP server over stdio and forwards calls; its source lives in
`bridge/` in this repo so it can be published and version-checked.

**Server functions** (`src/lib/mcp-connections.functions.ts`, auth-gated):
`startPairing` (mint code), `getConnectionStatus`, `disconnectProvider`, and
`callMcpTool` (enqueue a command, wait for the result with a timeout, return it).

**Chat and planner**
- `src/lib/chat-types.ts`: add `davinci_resolve` to `capabilitiesSchema`,
  `ALL_CAPS_ON`, `normalizeCapabilities`, and to `ACTION_GROUPS` so a Resolve request
  routes to a plan.
- `src/components/ChatDialog.tsx`: new `CAP_LABELS` entry
  ("DaVinci Resolve Mode" / "Edit, grade and export in Resolve"), an entry in
  `DEFAULT_CAPS`/`NO_CAPS`/`ACTION_TOOL_GROUPS`, plus a connection status pill and the
  setup card rendered when the toggle is on and the provider isn't connected.
- `src/components/mcp/McpSetupCard.tsx` and `McpStatusPill.tsx` — provider-agnostic.
- `src/lib/mcp-providers.ts` — the one place a provider is described. Resolve's entry
  names the MCP server package, the notes ("Resolve Studio must be open"), and a
  curated shortlist of its high-value tools so the planner sees a manageable menu
  rather than 300 raw tools.
- Planner (`supabase/functions/_shared/tools.ts`): one new tool `resolve_command`
  (tool name + arguments + why), grouped under a new `davinci_resolve` tool group so it
  is only offered when the toggle is on. Steps run through `callMcpTool`. The step
  result summary feeds back into plan memory, so later steps can refer to the timeline
  or clips the earlier ones made.
- `plan-compose` gets the Resolve tool requirement so multi-step Resolve jobs compose
  the same way image/video jobs do.

**Verification**
Typecheck, build log, and a Playwright pass at 390px on the toggle list, the setup
card, and the offline state. The end-to-end Resolve call can only be confirmed on a
machine running Resolve Studio, so that last mile is yours to try once the bridge is
installed.

## Open choice

I'll wire `jenkinsm13/resolve-mcp` by default (broadest current API coverage, MIT), with
the server command configurable in the provider entry so switching to
samuelgursky's is a one-line change.
