# Orby Call Mode: Web Search + Minimized Orb

Two independent changes to the live call experience.

## 1. Web search during a call (Perplexity)

When the user says something like "search the web for…", Orby calls a new
`web_search` tool, the app runs a Perplexity query, and the spoken result is fed
back so Orby answers out loud — no document writing required.

**New server function** (`src/lib/orby-call.functions.ts` or alongside the other call fns):
- `webSearchForCall` — `createServerFn` (POST, `requireSupabaseAuth`), input `{ query: string }`.
- Calls the Perplexity `/v1/agent` endpoint with `process.env.PERPLEXITY_API_KEY` (same key already used by the in-app Web Search), reusing the existing request shape from `webSearch` in `ai.functions.ts`.
- Instructions tuned for **speech**: short, conversational, 2–4 sentences, plain text, no markdown, no citation markers, no raw URLs read aloud.
- Returns `{ ok: true, text }` on success, `{ ok: false, error }` on failure (graceful — Orby tells the user it couldn't search).

**Realtime session tool** (`src/lib/orby-realtime.functions.ts`):
- Add a `web_search` function tool to the `tools` array with a `query` string parameter.
- Extend Orby's instructions so it uses `web_search` whenever the user asks to look something up online / search the web / find current info, then summarizes the result naturally.

**Tool bridge** (`src/contexts/CallModeContext.tsx`):
- Wire `useServerFn(webSearchForCall)`.
- Add a `case "web_search"` in `executeTool`: set status to `thinking` with an action label like "Searching the web…", call the fn, clear the label, and return the result text to the model so it speaks the answer.

## 2. Replace the yellow banner with a small orb button

The minimized call indicator (`src/routes/_authenticated/app.tsx`, ~line 2584) is a full-width centered yellow pill that covers the linked-document title.

- Replace it with a small circular orb button pinned to the **top-right** corner (respecting `env(safe-area-inset-top)`), no longer centered/full-width.
- Tapping the orb does the same thing as today: `setOverlayMinimized(false)` to reopen the call overlay (where mute / end / minimize already live).
- Use a subtle pulsing orb visual (reuse the existing `Orb` component or a small styled dot) instead of the yellow pill; keep an accessible `aria-label="Return to call"`.
- Remove the inline "End" sub-button from the banner since end/mute/minimize are all available once the overlay is reopened by tapping the orb (keeps the indicator a clean single tap target). 

## Technical notes
- `PERPLEXITY_API_KEY` already exists in the project (used by `ai.functions.ts` `webSearch`), so no new secret is needed.
- No database changes.
- The web search result is spoken only (not written into a document) to keep the call flow smooth; this can be extended later if desired.
