# Fix the DaVinci Resolve setup so the command actually works

## What went wrong

The command Orby gave you (`npx orby-bridge connect …`) points at a package name that was never
published to npm, so npm correctly answers "404 Not Found". Nothing on your Mac is misconfigured —
there is simply no program at that address to download.

## The fix: Orby serves the helper itself

Instead of relying on a published package, Orby will hand out its own helper file. The new one-time
command becomes a single copy/paste line that downloads the helper straight from your Orby app and
runs it:

```text
curl -fsSL https://orbyai.lovable.app/api/public/mcp-bridge/install -o ~/orby-bridge.mjs \
  && node ~/orby-bridge.mjs connect ANMNQK52
```

Nothing to install from npm, no package registry involved. Node.js (which you now have) is the only
requirement.

## What the helper does

- Pairs with Orby using your code, then keeps a connection open.
- Talks to DaVinci Resolve on your own machine through Resolve's built-in scripting support, so
  editing, grading, timeline building and exporting all happen locally.
- Prints plain-language status lines ("Connected to Resolve 20.2, project: My Film") and clear
  errors ("Resolve isn't open" / "This needs Resolve Studio").
- Keep that Terminal window open while you use DaVinci Resolve Mode; close it to stop the bridge.

## The setup card in the app gets rewritten

The card currently just shows a command. It will become numbered steps you can follow inside Orby:

1. Install Node.js (with a link), only if `node -v` doesn't print a version.
2. Open DaVinci Resolve Studio and check the Resolve settings (below).
3. Copy the one-line command and run it in Terminal.
4. Watch the card turn green by itself.

Plus a short troubleshooting note covering `command not found` and the 404 you hit.

## DaVinci Resolve settings to check

In Resolve: **Preferences → System → General**

- **External scripting using** → **Local** (you already did this — that's the only required setting).
- Leave the port field at its default; the helper uses Resolve's standard local connection.
- Nothing else on that page needs changing.

Also worth confirming:

- You're on **DaVinci Resolve Studio**, not free Resolve — free Resolve blocks external scripting.
- Resolve must be **open**, with a **project open** (not sitting on the Project Manager screen), when
  Orby runs a step.
- On first run macOS may ask permission for Terminal to control other apps — allow it.

## Technical detail

- New file `bridge/orby-bridge.mjs` — dependency-free Node ESM script. Subcommand `connect <code>`:
  POSTs to `/api/public/mcp-bridge/pair`, stores the returned token in `~/.orby/bridge.json`, then
  loops on `/api/public/mcp-bridge/poll` and posts outcomes to `/api/public/mcp-bridge/result`.
  Reconnects with backoff; `--server` flag lets a different Orby origin be targeted.
- Resolve access: the script locates Resolve's bundled scripting module via the standard
  `RESOLVE_SCRIPT_API` / `RESOLVE_SCRIPT_LIB` paths (macOS, Windows and Linux defaults), writes a
  small Python worker to `~/.orby/resolve_worker.py`, and drives it over stdio with one JSON request
  per command. Sends `server_info` (Resolve version, current project) on pair and on each poll so the
  status pill has something to show.
- New route `src/routes/api/public/mcp-bridge/install.ts` — GET returns the bridge source as
  `text/javascript` with no-cache headers, so the helper is always current. The script text is
  imported as a raw asset so there is one copy of it.
- `src/lib/mcp-providers.ts` — `installCommand(code)` returns the new curl+node line built from the
  published origin; `requirement` text updated. Provider registry stays the shape it is, so adding
  Photoshop/Blender later still means one entry.
- `src/components/mcp/McpConnectionPanel.tsx` — replaces the single code box with the numbered
  steps, a Node.js link, the Resolve settings checklist, the copy button on the one-liner, and the
  troubleshooting note. Still provider-agnostic (all strings come from the provider entry).

## Verification

Typecheck, build log, a check that `/api/public/mcp-bridge/install` serves the script, and a
Playwright pass at 390px on the rewritten setup card. The final Resolve handshake can only be
confirmed on your Mac with Resolve Studio open — run the new command once and tell me what the
Terminal prints.
