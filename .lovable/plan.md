# Fix the expired pairing code so DaVinci Resolve connects

## What's actually happening

Good news first: your Mac side is working. The helper downloaded, ran, and talked to
DaVinci Resolve Studio 21.0.4.5 and read your project name. The only thing that failed is
the little pairing code.

Checked the record: the code `ANMNQK52` was set to expire at 01:48, and you ran the command
at 02:23 — about 35 minutes too late. The setup card kept showing that old, dead code
instead of quietly replacing it, so copying it again could never work.

## What you do right now

Nothing complicated — but the card has to hand you a *new* code first, which the changes
below make it do automatically. After I make the change: open chat, toggle DaVinci Resolve
Mode off and on, copy the command, run it while Resolve is open. It should go green.

## The changes

1. **Codes last much longer** — 12 hours instead of 30 minutes, so a code you copied
   earlier in the day still works.
2. **The card never shows a dead code** — when the card opens and the current code is
   missing or past its time, it silently mints a fresh one, so the command you copy is
   always valid.
3. **A visible "time left" line and a "Get a fresh command" button** on the card, so you
   always know the code is good and can force a new one in one tap.
4. **A clearer failure message from the helper** — instead of just "expired", it says the
   code has run out and points you at the fresh-command button.
5. **The helper retries the handshake** a few times with a short wait rather than quitting
   instantly, so a code minted seconds later still catches.

## Technical detail

- `src/lib/mcp-connections.functions.ts` — `startMcpPairing` expiry 30 min → 12 h;
  `getMcpConnection` also returns `pairingExpiresAt` and treats an expired pending code as
  no code (`pairingCode: null`) so the UI can't render it.
- `src/lib/mcp-providers.ts` — `McpConnectionStatus` gains `pairingExpiresAt: string | null`.
- `src/components/mcp/McpConnectionPanel.tsx` — on mount / when status is not `connected`
  and there is no valid `pairingCode`, call `startMcpPairing` once automatically; render a
  "Code valid for another N h M m" line plus a `Get a fresh command` button that re-mints;
  drop the stale `data.pairingCode` fallback in favour of the validated value.
- `src/routes/api/public/mcp-bridge/pair.ts` — 410 body message reworded to name the
  fresh-command button; unchanged otherwise.
- `bridge/orby-bridge.mjs` — on a 404/410 pairing response, retry up to 5 times, 10 s
  apart, printing "Waiting for a fresh code…", then exit with the plain-language hint.

## Verification

Typecheck and the build log, plus a check that the card renders a live code with a time-left
line at 390 px. The real handshake is yours to confirm: run the fresh command once with
Resolve Studio open and tell me what Terminal prints.
