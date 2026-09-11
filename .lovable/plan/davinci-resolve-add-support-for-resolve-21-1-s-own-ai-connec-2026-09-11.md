# DaVinci Resolve: add support for Resolve 21.1's own AI connection

## Audit of what you have today

Your Resolve setup works like this:

- In chat, the 🎬 DaVinci Resolve Mode toggle turns the feature on (off by default, remembered per chat).
- Turning it on shows the setup card with a one-line command, a live pairing code with a
  countdown, and a "get a fresh command" button.
- That command downloads a small helper onto your Mac. The helper pairs with Orby using the
  code, then keeps checking in every couple of seconds.
- Orby never touches your Mac directly. It puts a command in a queue; your helper picks it up,
  runs it inside Resolve through Resolve's own scripting support, and posts the answer back.
- Orby knows 100 named Resolve commands (projects, timelines, tracks, clips, colour, Fusion,
  markers, render). The planner uses one command per step.
- Status shows as a pill: connected (with Resolve version and project name), waiting,
  or not reachable. Codes last 12 hours.
- Errors from Resolve come back as plain text and appear in the chat as a failed step.
- There is currently **no "are you sure?" step** — with the toggle on, commands run immediately.

## What the research actually confirmed

Confirmed by multiple outlets quoting Blackmagic's release notes:

- Resolve 21.1 (8 Sept 2026) does include a Blackmagic-built native MCP server, and it is
  **Studio only** — [CineD](https://www.cined.com/davinci-resolve-21-1-released-ai-assistant-integration-via-mcp-individual-hdr-trims-and-python-scripting-moves-to-studio/),
  [pttl.gr](https://www.pttl.gr/en/davinci-resolve-21-1-ai-assistants-mcp-claude-codex/).
- Python scripting was removed from free Resolve in 21.1 (direct quote from Blackmagic's notes) —
  [Puget Systems](https://www.pugetsystems.com/blog/2026/09/10/how-davinci-resolve-free-v21-1-scripting-changes-affect-puget-bench/).
- 21.1 adds ~20 new scripting calls the AI layer builds on: multicam create/flatten, SmartSwitch,
  auto-align clips, transitions, audio normalise, fades, speed changes, clip transcriptions with
  speaker and timing, render presets, project setting presets, cloning media, source audio mapping,
  output blanking, DCTL validate/encrypt — [CineD](https://www.cined.com/davinci-resolve-21-1-released-ai-assistant-integration-via-mcp-individual-hdr-trims-and-python-scripting-moves-to-studio/).
- What the assistant can do is limited to what Resolve chooses to expose —
  [pttl.gr](https://www.pttl.gr/en/davinci-resolve-21-1-ai-assistants-mcp-claude-codex/).

**Not confirmed anywhere official**, and this is the blocker: how an outside program actually
connects. No verified address, port, config file, on/off location, sign-in method, or official list
of command names. Blackmagic's own release and support pages don't serve readable text to a
script. The one article with step-by-step setup instructions points at a community package, not a
Blackmagic one — [byteiota](https://byteiota.com/davinci-resolve-21-1-mcp-server/). A tool count of
"88 tools" circulating online traces back to a community project, not Blackmagic.

So: I will not write connection code against guessed details. Step 0 below closes that gap using
your own machine, which is the only reliable source right now.

## Decision

Keep what works, add the new one behind a switch: **your current helper stays the default**, and
Resolve 21.1's native connection becomes a second provider once verified on your Mac. Nothing is
removed. Reason: your existing path is proven end to end today and works on any Studio version,
while the native one is one week old with no published connection contract.

## Plan

**Step 0 — verify on your Mac (needs you, ~2 minutes)**

I add a `check` command to the helper you already have. You run one line in Terminal; it reports
your Resolve version, whether a native AI/MCP endpoint is listening locally, and what commands it
advertises. It only reads — it changes nothing. You paste me the output. If nothing is found, I
say so plainly and we stop there with your current setup untouched.

**Step 1 — provider layer**

Split the Resolve code into a provider interface (connect, list capabilities, run a command,
report status) with two implementations: `bridge` (today's helper) and `native` (21.1). The chat
toggle, setup card, status pill and planner keep talking to the interface only, so adding
Photoshop or Blender later is still one entry.

**Step 2 — choose provider**

A setting in the DaVinci panel: Automatic (default), Resolve 21.1 native, Legacy helper.
Automatic prefers native only when Step 0's check succeeds on that machine, otherwise silently
uses the helper.

**Step 3 — capabilities instead of assumptions**

Orby asks the connected provider what it can do and works from that answer, rather than the
hard-coded 100-name list. Unknown request → Orby says the connected Resolve can't do it instead
of inventing a command.

**Step 4 — safer conversation**

Update Orby's Resolve instructions: ask when the edit intent is unclear, state the plan for
consequential jobs before running, require a confirm tap for anything destructive or hard to undo
(delete clip/track/timeline, overwrite, render over a file, project changes), never repeat the
same command twice, and never say "done" until Resolve confirms it.

**Step 5 — connection quality**

Version detection, capability discovery, clear reconnect, per-command timeouts, structured errors,
and specific messages for: Resolve closed, no project open, free edition (needs Studio),
scripting/AI access turned off, provider unreachable, command unsupported. Logs carry no codes
or tokens.

**Step 6 — tests**

Connect, capability discovery, ordinary command, confirm-required command, failure, reconnect,
unsupported command, and automatic falling back to the existing helper.

## Technical detail

- `src/lib/mcp-providers.ts` → provider registry gains a `transport` variant per provider entry;
  tool catalogue becomes a fallback when live capability discovery is unavailable.
- New `src/lib/resolve-provider.ts` — the interface plus `bridge` and `native` adapters; the
  planner tool `resolve_command` and `callMcpTool` route through it, unchanged in shape.
- `mcp_connections` gains `transport` and `capabilities` (jsonb) columns via a migration; existing
  rows default to `bridge`, so current connections keep working with no re-pairing.
- `bridge/orby-bridge.mjs` — new `check` subcommand (read-only probe: Resolve version, edition,
  local endpoint discovery, advertised commands); `BRIDGE_VERSION` → 4. Native transport is only
  implemented after Step 0 confirms the real contract.
- `supabase/functions/_shared/tools.ts` and `plan-compose` — Resolve tool description switches to
  the discovered capability list; destructive commands get a `confirm_required` flag handled by the
  existing plan approval UI rather than a new one.
- `src/components/mcp/McpConnectionPanel.tsx` — provider selector, version/edition line, capability
  count, and the expanded troubleshooting messages.
- Security unchanged in principle: nothing privileged in the browser, pairing codes short-lived,
  only token hashes stored, all local-machine access via the helper you run yourself. A hosted site
  cannot reach a local port on your Mac directly, so even "native" mode is proxied by the helper —
  that constraint doesn't disappear with 21.1.
- Tests as `tests/resolve-provider.test.ts` (vitest), plus typecheck and build.

## Open questions for you

1. Is your Resolve definitely **Studio 21.1** (not free, not 21.0)? Free 21.1 cannot do any of this.
2. OK to start with Step 0's read-only check on your Mac before I write connection code?
